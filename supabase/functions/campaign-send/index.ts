// Campaign send adapter. Requires an authenticated workspace owner.
// Sending stays DISABLED until a real email provider is configured via
// server-side secrets AND a verified sender is set. Without configuration
// this endpoint returns the recipient estimate and an explicit
// "not configured" state — it never simulates a send.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "Sign in required." });

  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const url = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await authed.auth.getUser(jwt);
  if (!userData?.user) return json(401, { error: "Sign in required." });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
  if (!campaignId) return json(400, { error: "campaign_id is required." });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: campaign } = await admin.from("campaigns").select("id, workspace_id, status, segment_id").eq("id", campaignId).maybeSingle();
  if (!campaign) return json(404, { error: "Campaign not found." });

  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", campaign.workspace_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json(403, { error: "Only workspace owners and admins can manage sending." });
  }

  // Recipients: subscribed contacts in the segment, minus every suppression.
  const { data: segment } = campaign.segment_id
    ? await admin.from("segments").select("filter").eq("id", campaign.segment_id).maybeSingle()
    : { data: null };
  const filter = ((segment?.filter as Record<string, unknown>) ?? {}) as {
    tags?: string[];
    sources?: string[];
    subscription_status?: string;
  };
  const statusFilter = filter.subscription_status === "unsubscribed" ? "unsubscribed" : "subscribed";

  let query = admin
    .from("contacts")
    .select("email_norm, unsubscribe_token")
    .eq("workspace_id", campaign.workspace_id)
    .eq("subscription_status", statusFilter);
  if (filter.tags?.length) query = query.contains("tags", filter.tags);
  if (filter.sources?.length) query = query.in("source", filter.sources);
  const { data: contacts } = await query.limit(20000);

  const { data: suppressed } = await admin
    .from("suppressions")
    .select("email_norm")
    .eq("workspace_id", campaign.workspace_id)
    .in("reason", ["unsubscribe", "bounce", "complaint"]);
  const suppressedSet = new Set((suppressed ?? []).map((s) => s.email_norm));
  const recipients = (contacts ?? []).filter((c) => !suppressedSet.has(c.email_norm));

  // Provider configuration: requires secrets + verified sender.
  const providerKey = Deno.env.get("EMAIL_PROVIDER_API_KEY");
  const senderEmail = Deno.env.get("SUNSHADE_SENDER_EMAIL");
  const verifiedDomains = (Deno.env.get("SUNSHADE_VERIFIED_DOMAINS") ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const senderDomain = senderEmail ? senderEmail.split("@")[1]?.toLowerCase() : undefined;
  const senderVerified = Boolean(senderEmail && senderDomain && verifiedDomains.includes(senderDomain));

  if (!providerKey || !senderVerified) {
    return json(200, {
      configured: false,
      recipients: recipients.length,
      message:
        "Sending is disabled. Connect an email provider and verify a sending domain in Project Settings before campaigns can be delivered.",
    });
  }

  // Provider adapter (HTTP API). Kept disabled in this build: a real provider
  // account and verified domain must exist before this branch can run.
  return json(503, {
    configured: true,
    recipients: recipients.length,
    error:
      "The delivery provider is not connected yet. Campaign delivery is intentionally disabled in this build; no messages have been sent.",
  });
});
