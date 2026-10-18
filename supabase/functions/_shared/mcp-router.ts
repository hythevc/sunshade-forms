// Sunshade MCP endpoint router — pure request handling with injected data
// access. The edge function supplies auth + database access; unit tests
// supply fakes, so authentication and tenant isolation are testable.

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface AgentContext {
  workspaceId: string;
  tokenId: string;
  scopes: string[];
}

export interface McpDataDeps {
  listForms(workspaceId: string): Promise<Record<string, unknown>[]>;
  getFormResponses(workspaceId: string, formId: string, limit: number): Promise<Record<string, unknown>[]>;
  listContacts(workspaceId: string, search: string | null, limit: number): Promise<Record<string, unknown>[]>;
  createFormDraft(workspaceId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  createCampaignDraft(workspaceId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface McpDeps extends McpDataDeps {
  /** Pre-resolved agent context (validated by the edge function), or null. */
  agent: AgentContext | null;
}

const PROTOCOL_VERSION = "2025-06-18";

const TOOL_SCOPES: Record<string, "read" | "write"> = {
  list_forms: "read",
  get_form_responses: "read",
  list_contacts: "read",
  create_form_draft: "write",
  create_campaign_draft: "write",
};

export const TOOL_DEFINITIONS = [
  {
    name: "list_forms",
    description: "List forms in your Sunshade workspace, including draft and published status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_form_responses",
    description: "Read responses submitted to one of your forms.",
    inputSchema: {
      type: "object",
      properties: {
        form_id: { type: "string", description: "The form id." },
        limit: { type: "number", description: "Max responses to return (1-200, default 50)." },
      },
      required: ["form_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_contacts",
    description: "List contacts in your Sunshade workspace, optionally filtered by a search string.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional text matched against name or email." },
        limit: { type: "number", description: "Max contacts to return (1-200, default 50)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_form_draft",
    description:
      "Create a new form in draft status. Drafts are never published or sent — publishing must be done in the Sunshade app.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Form title (1-200 chars)." },
        description: { type: "string", description: "Optional form description." },
        capture_contact: { type: "boolean", description: "Whether the form captures an email contact." },
        fields: {
          type: "array",
          description: "Form fields.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["short_text", "long_text", "email", "number", "single_choice", "multiple_choice", "rating", "consent"],
              },
              label: { type: "string" },
              required: { type: "boolean" },
              options: { type: "array", items: { type: "string" } },
            },
            required: ["type", "label"],
          },
        },
      },
      required: ["title", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "create_campaign_draft",
    description:
      "Create a newsletter campaign draft. Drafts are never sent — sending requires a configured provider and must be done in the Sunshade app.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Campaign name." },
        subject: { type: "string", description: "Email subject line." },
        preview_text: { type: "string", description: "Preheader text." },
        body: { type: "string", description: "Plain text body." },
        segment_id: { type: "string", description: "Optional segment to target." },
      },
      required: ["name", "subject"],
      additionalProperties: false,
    },
  },
];

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export async function callTool(
  deps: McpDataDeps,
  ctx: AgentContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const needed = TOOL_SCOPES[name];
  if (!needed) {
    return rpcError(null, RPC_METHOD_NOT_FOUND, `Unknown tool: ${name}`);
  }
  if (!ctx.scopes.includes(needed)) {
    return rpcError(null, -32600, `Token is missing the '${needed}' scope required for ${name}.`);
  }

  switch (name) {
    case "list_forms": {
      const forms = await deps.listForms(ctx.workspaceId);
      return { content: [{ type: "text", text: JSON.stringify({ forms }) }] };
    }
    case "get_form_responses": {
      const formId = String(args.form_id ?? "");
      if (!formId) return rpcError(null, RPC_INVALID_PARAMS, "form_id is required.");
      const limitRaw = args.limit == null ? 50 : Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
      const responses = await deps.getFormResponses(ctx.workspaceId, formId, limit);
      return { content: [{ type: "text", text: JSON.stringify({ responses }) }] };
    }
    case "list_contacts": {
      const search = args.search == null ? null : String(args.search);
      const limitRaw = args.limit == null ? 50 : Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
      const contacts = await deps.listContacts(ctx.workspaceId, search, limit);
      return { content: [{ type: "text", text: JSON.stringify({ contacts }) }] };
    }
    case "create_form_draft": {
      const title = String(args.title ?? "").trim();
      if (!title || title.length > 200) {
        return rpcError(null, RPC_INVALID_PARAMS, "title is required (1-200 characters).");
      }
      const form = await deps.createFormDraft(ctx.workspaceId, {
        title,
        description: args.description == null ? null : String(args.description).slice(0, 500),
        capture_contact: args.capture_contact === true,
        fields: Array.isArray(args.fields) ? args.fields.slice(0, 50) : [],
      });
      return { content: [{ type: "text", text: JSON.stringify({ form }) }] };
    }
    case "create_campaign_draft": {
      const name = String(args.name ?? "").trim();
      if (!name) return rpcError(null, RPC_INVALID_PARAMS, "name is required.");
      const campaign = await deps.createCampaignDraft(ctx.workspaceId, {
        name: name.slice(0, 120),
        subject: String(args.subject ?? "").slice(0, 200),
        preview_text: String(args.preview_text ?? "").slice(0, 300),
        body: String(args.body ?? "").slice(0, 50000),
        segment_id: args.segment_id == null ? null : String(args.segment_id),
      });
      return { content: [{ type: "text", text: JSON.stringify({ campaign }) }] };
    }
    default:
      return rpcError(null, RPC_METHOD_NOT_FOUND, `Unknown tool: ${name}`);
  }
}

/**
 * Handle one JSON-RPC request body. Returns the response object to serialize
 * (or null for notifications).
 */
export async function handleMcpRpc(
  body: unknown,
  deps: McpDeps,
): Promise<{ status: number; payload: unknown }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: 400, payload: rpcError(null, -32600, "Invalid JSON-RPC request.") };
  }
  const req = body as JsonRpcRequest;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { status: 400, payload: rpcError(null, -32600, "Invalid JSON-RPC request.") };
  }

  // Notifications (no id) produce no response body.
  if (req.id === undefined) {
    return { status: 202, payload: null };
  }

  if (req.method === "initialize") {
    return {
      status: 200,
      payload: rpcResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "sunshade", version: "1.0.0" },
        instructions:
          "Sunshade MCP: forms, responses and contacts for your workspace. Draft tools never publish or send campaigns.",
      }),
    };
  }

  if (req.method === "tools/list") {
    return { status: 200, payload: rpcResult(req.id, { tools: TOOL_DEFINITIONS }) };
  }

  if (req.method === "tools/call") {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    if (!name) {
      return { status: 200, payload: rpcError(req.id, RPC_INVALID_PARAMS, "Tool name is required.") };
    }
    if (!deps.agent) {
      return { status: 200, payload: rpcError(req.id, -32000, "Unauthorized.") };
    }
    const needed = TOOL_SCOPES[name];
    if (needed && !deps.agent.scopes.includes(needed)) {
      return {
        status: 200,
        payload: rpcError(req.id, -32600, `Token is missing the '${needed}' scope required for ${name}.`),
      };
    }
    try {
      const result = await callTool(deps, deps.agent, name, args);
      return { status: 200, payload: rpcResult(req.id, result) };
    } catch (err) {
      return {
        status: 200,
        payload: rpcError(req.id, RPC_INTERNAL_ERROR, err instanceof Error ? err.message : "Tool failed."),
      };
    }
  }

  return { status: 200, payload: rpcError(req.id, RPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`) };
}
