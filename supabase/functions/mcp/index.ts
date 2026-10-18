// Sunshade MCP endpoint. Authenticates agent tokens (hashed at rest,
// tenant-scoped, scoped read/write) and serves the JSON-RPC MCP protocol.
// Agent tokens can only create drafts — never publish or send.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { handleMcpRpc, type McpDataDeps } from "../_shared/mcp-router.ts";
import { hashToken } from "../_shared/tokens.ts";

function json(status: number, body: unknown) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Use POST." } });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  let agent: { workspaceId: string; tokenId: string; scopes: string[] } | null = null;
  if (token) {
    const hash = await hashToken(token);
    const { data: row } = await admin
      .from("agent_tokens")
      .select("id, workspace_id, scopes, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (row && !row.revoked_at) {
      agent = { workspaceId: row.workspace_id, tokenId: row.id, scopes: (row.scopes as string[]) ?? [] };
      await admin.from("agent_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  if (!agent) {
    return json(401, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Unauthorized." } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  }

  const dataDeps: McpDataDeps = {
    listForms: async (workspaceId) => {
      const { data } = await admin
        .from("forms")
        .select("id, title, description, status, capture_contact, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    getFormResponses: async (workspaceId, formId, limit) => {
      const { data } = await admin
        .from("form_responses")
        .select("id, form_id, answers, submitted_at, contact_id")
        .eq("workspace_id", workspaceId)
        .eq("form_id", formId)
        .order("submitted_at", { ascending: false })
        .limit(limit);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    listContacts: async (workspaceId, search, limit) => {
      let q = admin
        .from("contacts")
        .select("id, email, name, tags, subscription_status, source, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (search) q = q.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
      const { data } = await q;
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    createFormDraft: async (workspaceId, input) => {
      const fields = (input.fields as Record<string, unknown>[]) ?? [];
      const safeFields = fields
        .filter((f) => f && typeof f.type === "string" && typeof f.label === "string")
        .map((f, i) => ({
          id: `f${i + 1}`,
          type: String(f.type),
          label: String(f.label).slice(0, 200),
          required: f.required === true,
          ...(Array.isArray(f.options) ? { options: f.options.map(String).slice(0, 30) } : {}),
        }));
      const { data, error } = await admin
        .from("forms")
        .insert({
          workspace_id: workspaceId,
          title: String(input.title).slice(0, 200),
          description: input.description ? String(input.description) : null,
          capture_contact: input.capture_contact === true,
          draft: { fields: safeFields },
          created_by: null,
        })
        .select("id, title, status, created_at")
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as Record<string, unknown>;
    },
    createCampaignDraft: async (workspaceId, input) => {
      const { data, error } = await admin
        .from("campaigns")
        .insert({
          workspace_id: workspaceId,
          name: String(input.name).slice(0, 120),
          subject: String(input.subject ?? "").slice(0, 200),
          preview_text: String(input.preview_text ?? "").slice(0, 300),
          body: String(input.body ?? "").slice(0, 50000),
          segment_id: input.segment_id ? String(input.segment_id) : null,
          status: "draft",
        })
        .select("id, name, subject, status, created_at")
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as Record<string, unknown>;
    },
  };

  const { status, payload } = await handleMcpRpc(body, { ...dataDeps, agent });
  if (status === 202 || payload === null) return new Response(null, { status: 202, headers: corsHeaders });
  return json(status, payload);
});
