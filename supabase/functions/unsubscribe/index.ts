// Public unsubscribe endpoint. One-time tokens let a contact opt out of
// campaigns. Unsubscribes always create a suppression record so a later form
// submission can never silently re-subscribe the contact.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function html(status: number, title: string, message: string) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — Sunshade</title><style>body{font-family:system-ui,sans-serif;background:#FAF7F2;color:#221D15;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;padding:2.5rem 2rem;border:1px solid #E7DFD3;border-radius:12px;max-width:26rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#6B6152;margin:0;font-size:.95rem;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new Response(page, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handle(token: string) {
  if (!token) return html(400, "Invalid link", "This unsubscribe link is missing its token.");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: contact } = await admin
    .from("contacts")
    .select("id, workspace_id, email_norm, subscription_status")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (!contact) return html(404, "Link expired", "This unsubscribe link is not valid any more.");

  const now = new Date().toISOString();
  await admin
    .from("contacts")
    .update({ subscription_status: "unsubscribed" })
    .eq("id", contact.id);
  await admin.from("suppressions").upsert(
    {
      workspace_id: contact.workspace_id,
      email_norm: contact.email_norm,
      reason: "unsubscribe",
      source: "unsubscribe_link",
    },
    { onConflict: "workspace_id,email_norm,reason" },
  );
  return html(200, "You're unsubscribed", "This email address will not receive further campaigns from this workspace. This cannot be undone by resubmitting a form.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  let token = url.searchParams.get("token") ?? "";
  if (!token && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.token === "string") token = body.token;
    } catch {
      /* ignore */
    }
  }
  return handle(token);
});
