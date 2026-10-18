// Public form submission endpoint. Validates every answer server-side,
// stores the response, and optionally upserts a contact with explicit-consent
// subscription logic. Never exposes tenant identity or other responses.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { validateSubmission, type FormDefinition } from "../_shared/types.ts";
import { resolveContactUpdate } from "../_shared/consent.ts";

type Json = Record<string, unknown>;

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  let body: Json;
  try {
    body = (await req.json()) as Json;
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const formId = typeof body.form_id === "string" ? body.form_id : "";
  const answers = body.answers && typeof body.answers === "object" ? (body.answers as Json) : {};
  const contactName = typeof body.contact_name === "string" ? body.contact_name.trim().slice(0, 200) : "";
  if (!formId) return json(400, { error: "form_id is required." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Load the form and its LIVE published version only.
  const { data: form, error: formErr } = await admin
    .from("forms")
    .select("id, workspace_id, status, published_version_id, capture_contact")
    .eq("id", formId)
    .maybeSingle();
  if (formErr) return json(500, { error: "Could not load the form." });
  if (!form) return json(404, { error: "Form not found." });
  if (form.status !== "published" || !form.published_version_id) {
    return json(404, { error: "This form is not accepting responses right now." });
  }

  const { data: version } = await admin
    .from("form_versions")
    .select("id, definition")
    .eq("id", form.published_version_id)
    .eq("form_id", formId)
    .maybeSingle();
  if (!version) return json(404, { error: "This form is not accepting responses right now." });

  const definition = (version.definition ?? {}) as FormDefinition;
  const result = validateSubmission(definition, answers);
  if (!result.ok) {
    return json(400, { error: "Some answers need attention.", field_errors: result.errors });
  }

  // Monthly response limit for the beta plan.
  const { data: ws } = await admin.from("workspaces").select("plan").eq("id", form.workspace_id).maybeSingle();
  const limits: Record<string, number> = { beta_free: 100, beta_growth: 2000, beta_team: 10000 };
  const limit = limits[(ws?.plan as string) ?? "beta_free"] ?? 100;
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("form_responses")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", form.workspace_id)
    .gte("submitted_at", startOfMonth.toISOString());
  if ((count ?? 0) >= limit) {
    return json(429, { error: "This form has reached its monthly response limit for now." });
  }

  // Optional contact capture with explicit consent + suppression rules.
  let contactId: string | null = null;
  if (form.capture_contact) {
    const emailField = definition.fields?.find((f) => f.type === "email");
    const email = emailField ? result.normalized[emailField.id] : null;
    if (typeof email === "string" && email) {
      const emailNorm = email.toLowerCase().trim();
      const { data: existing } = await admin
        .from("contacts")
        .select("id, subscription_status, consent_given_at, consent_version, consent_source")
        .eq("workspace_id", form.workspace_id)
        .eq("email_norm", emailNorm)
        .maybeSingle();

      const { data: suppressedRow } = await admin
        .from("suppressions")
        .select("id")
        .eq("workspace_id", form.workspace_id)
        .eq("email_norm", emailNorm)
        .in("reason", ["unsubscribe", "complaint", "bounce"])
        .maybeSingle();

      const consentSource = `form:${formId}`;
      const { patch } = resolveContactUpdate({
        existing: (existing as never) ?? null,
        wantsConsent: result.wantsConsent,
        consentVersion: result.consentVersion,
        consentSource,
        suppressed: Boolean(suppressedRow),
        now: new Date().toISOString(),
      });

      if (existing) {
        const { data: updated, error: updErr } = await admin
          .from("contacts")
          .update({ ...patch, ...(contactName ? { name: contactName } : {}) })
          .eq("id", existing.id)
          .select("id")
          .maybeSingle();
        if (!updErr && updated) contactId = updated.id;
      } else {
        // Respect the workspace contact cap: skip contact creation when full,
        // but never lose the response itself.
        const contactLimits: Record<string, number> = { beta_free: 500, beta_growth: 5000, beta_team: 20000 };
        const contactCap = contactLimits[(ws?.plan as string) ?? "beta_free"] ?? 500;
        const { count: contactCount } = await admin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", form.workspace_id);
        if ((contactCount ?? 0) < contactCap) {
          const { data: created, error: insErr } = await admin
            .from("contacts")
            .insert({
              workspace_id: form.workspace_id,
              email,
              email_norm: emailNorm,
              name: contactName || null,
              source: consentSource,
              form_id: formId,
              ...patch,
            })
            .select("id")
            .maybeSingle();
          if (!insErr && created) contactId = created.id;
        }
      }
    }
  }

  const { error: respErr } = await admin.from("form_responses").insert({
    workspace_id: form.workspace_id,
    form_id: formId,
    version_id: version.id,
    answers: result.normalized,
    contact_id: contactId,
  });
  if (respErr) return json(500, { error: "Could not save your response." });

  return json(200, { ok: true, contact_saved: contactId !== null, subscribed: false });
});
