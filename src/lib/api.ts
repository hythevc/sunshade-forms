import { supabase } from "@/integrations/supabase/client";
import type { FormDefinition } from "./shared";
import { generateToken, hashToken, tokenPrefix } from "./shared";
import { TEMPLATES } from "./templates";
import { normalizeFilter, type SegmentFilter } from "./segments";

export const PLAN_LIMITS: Record<string, { label: string; price: string; forms: number; responses: number; contacts: number }> = {
  beta_free: { label: "Free", price: "€0", forms: 3, responses: 100, contacts: 500 },
  beta_growth: { label: "Growth", price: "€19", forms: 20, responses: 2000, contacts: 5000 },
  beta_team: { label: "Team", price: "€39", forms: 100, responses: 10000, contacts: 20000 },
};

export interface FormRow {
  id: string;
  title: string;
  status: "draft" | "published";
  capture_contact: boolean;
  draft: FormDefinition;
  published_version_id: string | null;
  updated_at: string;
  created_at: string;
}
export interface ResponseRow { id: string; form_id: string; answers: Record<string, unknown>; submitted_at: string; contact_id: string | null }
export interface ContactRow {
  id: string; email: string; email_norm: string; name: string | null; source: string; tags: string[];
  subscription_status: string; consent_given_at: string | null; consent_version: string | null; consent_source: string | null; created_at: string;
}
export interface NewContact { email: string; name?: string; tags?: string[]; consentAttested?: boolean }
export interface SegmentRow { id: string; name: string; filter: SegmentFilter }
export interface CampaignRow { id: string; name: string; subject: string; preview_text: string; body: string; segment_id: string | null; status: string; updated_at: string }
export interface TokenRow { id: string; name: string; token_prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }
export interface Workspace { id: string; name: string; plan: string; role?: string }
export interface DeliveryCheck { configured: boolean; recipients: number; message: string }

export interface Api {
  mode: "cloud" | "demo";
  workspace(): Promise<Workspace>;
  renameWorkspace(name: string): Promise<void>;
  listForms(): Promise<FormRow[]>;
  getForm(id: string): Promise<{ form: FormRow; published: FormDefinition | null }>;
  createForm(templateId: string): Promise<FormRow>;
  saveDraft(id: string, def: FormDefinition): Promise<void>;
  duplicateForm(id: string): Promise<FormRow>;
  publishForm(id: string): Promise<void>;
  unpublishForm(id: string): Promise<void>;
  deleteForm(id: string): Promise<void>;
  listResponses(): Promise<ResponseRow[]>;
  deleteResponse(id: string): Promise<void>;
  listContacts(): Promise<ContactRow[]>;
  addContacts(rows: NewContact[]): Promise<number>;
  updateContactTags(id: string, tags: string[]): Promise<void>;
  unsubscribeContact(id: string): Promise<void>;
  listSuppressed(): Promise<Set<string>>;
  listSegments(): Promise<SegmentRow[]>;
  saveSegment(seg: { id?: string; name: string; filter: SegmentFilter }): Promise<void>;
  deleteSegment(id: string): Promise<void>;
  listCampaigns(): Promise<CampaignRow[]>;
  getCampaign(id: string): Promise<CampaignRow>;
  createCampaign(): Promise<CampaignRow>;
  saveCampaign(id: string, patch: Partial<CampaignRow>): Promise<void>;
  duplicateCampaign(id: string): Promise<CampaignRow>;
  deleteCampaign(id: string): Promise<void>;
  checkDelivery(id: string): Promise<DeliveryCheck>;
  listTokens(): Promise<TokenRow[]>;
  createToken(name: string, scopes: string[]): Promise<string>;
  revokeToken(id: string): Promise<void>;
}

const must = <T,>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const FORM_COLS = "id,title,status,capture_contact,draft,published_version_id,updated_at,created_at";

export function cloudApi(ws: Workspace, userId: string): Api {
  const w = ws.id;
  const db = supabase as any;
  return {
    mode: "cloud",
    async workspace() {
      const row = must(await db.from("workspaces").select("id,name,plan").eq("id", w).single());
      return { ...row, role: ws.role };
    },
    async renameWorkspace(name) { must(await db.from("workspaces").update({ name }).eq("id", w)); },
    async listForms() {
      return must(await db.from("forms").select(FORM_COLS).eq("workspace_id", w).order("updated_at", { ascending: false }));
    },
    async getForm(id) {
      const form = must(await db.from("forms").select(FORM_COLS).eq("id", id).eq("workspace_id", w).single()) as FormRow;
      let published: FormDefinition | null = null;
      if (form.published_version_id) {
        const v = must(await db.from("form_versions").select("definition").eq("id", form.published_version_id).maybeSingle()) as any;
        published = v?.definition ?? null;
      }
      return { form, published };
    },
    async createForm(templateId) {
      const def = (TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]).build();
      return must(await db.from("forms").insert({ workspace_id: w, created_by: userId, title: def.title, description: def.description, capture_contact: !!def.capture_contact, draft: def, theme: def.theme ?? {} }).select(FORM_COLS).single());
    },
    async saveDraft(id, def) {
      must(await db.from("forms").update({ draft: def, title: def.title || "Untitled form", description: def.description ?? null, capture_contact: !!def.capture_contact, theme: def.theme ?? {} }).eq("id", id).eq("workspace_id", w));
    },
    async duplicateForm(id) {
      const { form } = await this.getForm(id);
      const def = { ...form.draft, title: `${form.draft.title} (copy)` };
      return must(await db.from("forms").insert({ workspace_id: w, created_by: userId, title: def.title, capture_contact: !!def.capture_contact, draft: def, theme: def.theme ?? {} }).select(FORM_COLS).single());
    },
    async publishForm(id) {
      const { form } = await this.getForm(id);
      if (!form.draft.fields?.length) throw new Error("Add at least one question before publishing.");
      const last = must(await db.from("form_versions").select("version_number").eq("form_id", id).order("version_number", { ascending: false }).limit(1)) as any[];
      const v = must(await db.from("form_versions").insert({ form_id: id, version_number: (last[0]?.version_number ?? 0) + 1, definition: form.draft }).select("id").single()) as any;
      must(await db.from("forms").update({ status: "published", published_version_id: v.id }).eq("id", id));
    },
    async unpublishForm(id) { must(await db.from("forms").update({ status: "draft" }).eq("id", id).eq("workspace_id", w)); },
    async deleteForm(id) {
      const { count } = await db.from("form_responses").select("id", { count: "exact", head: true }).eq("form_id", id);
      if ((count ?? 0) > 0) throw new Error("This form has responses. Unpublish it instead, or delete its responses first.");
      must(await db.from("forms").update({ published_version_id: null, status: "draft" }).eq("id", id));
      must(await db.from("form_versions").delete().eq("form_id", id));
      must(await db.from("forms").delete().eq("id", id));
    },
    async listResponses() {
      return must(await db.from("form_responses").select("id,form_id,answers,submitted_at,contact_id").eq("workspace_id", w).order("submitted_at", { ascending: false }).limit(5000));
    },
    async deleteResponse(id) { must(await db.from("form_responses").delete().eq("id", id)); },
    async listContacts() {
      return must(await db.from("contacts").select("id,email,email_norm,name,source,tags,subscription_status,consent_given_at,consent_version,consent_source,created_at").eq("workspace_id", w).order("created_at", { ascending: false }).limit(20000));
    },
    async addContacts(rows) {
      if (!rows.length) return 0;
      const now = new Date().toISOString();
      const payload = rows.map((r) => ({
        workspace_id: w, email: r.email.trim(), email_norm: r.email.trim().toLowerCase(), name: r.name || null, tags: r.tags ?? [],
        source: "manual",
        ...(r.consentAttested ? { subscription_status: "subscribed", consent_given_at: now, consent_version: "manual-attested", consent_source: `manual:${userId}` } : { subscription_status: "unsubscribed" }),
      }));
      let n = 0;
      for (let i = 0; i < payload.length; i += 500) {
        const res = must(await db.from("contacts").upsert(payload.slice(i, i + 500), { onConflict: "workspace_id,email_norm", ignoreDuplicates: true }).select("id")) as any[];
        n += res.length;
      }
      return n;
    },
    async updateContactTags(id, tags) { must(await db.from("contacts").update({ tags }).eq("id", id)); },
    async unsubscribeContact(id) {
      const c = must(await db.from("contacts").update({ subscription_status: "unsubscribed" }).eq("id", id).select("email_norm").single()) as any;
      await db.from("suppressions").insert({ workspace_id: w, email_norm: c.email_norm, reason: "unsubscribe", source: "manual" });
    },
    async listSuppressed() {
      const rows = must(await db.from("suppressions").select("email_norm").eq("workspace_id", w)) as any[];
      return new Set(rows.map((r) => r.email_norm));
    },
    async listSegments() {
      const rows = must(await db.from("segments").select("id,name,filter").eq("workspace_id", w).order("created_at")) as any[];
      return rows.map((r) => ({ ...r, filter: normalizeFilter(r.filter) }));
    },
    async saveSegment(s) {
      if (s.id) must(await db.from("segments").update({ name: s.name, filter: s.filter }).eq("id", s.id));
      else must(await db.from("segments").insert({ workspace_id: w, name: s.name, filter: s.filter, created_by: userId }));
    },
    async deleteSegment(id) {
      must(await db.from("campaigns").update({ segment_id: null }).eq("segment_id", id));
      must(await db.from("segments").delete().eq("id", id));
    },
    async listCampaigns() { return must(await db.from("campaigns").select("*").eq("workspace_id", w).order("updated_at", { ascending: false })); },
    async getCampaign(id) { return must(await db.from("campaigns").select("*").eq("id", id).eq("workspace_id", w).single()); },
    async createCampaign() { return must(await db.from("campaigns").insert({ workspace_id: w, created_by: userId }).select("*").single()); },
    async saveCampaign(id, p) {
      const { name, subject, preview_text, body, segment_id } = p;
      must(await db.from("campaigns").update({ name, subject, preview_text, body, segment_id }).eq("id", id));
    },
    async duplicateCampaign(id) {
      const c = await this.getCampaign(id);
      return must(await db.from("campaigns").insert({ workspace_id: w, created_by: userId, name: `${c.name} (copy)`, subject: c.subject, preview_text: c.preview_text, body: c.body, segment_id: c.segment_id }).select("*").single());
    },
    async deleteCampaign(id) { must(await db.from("campaigns").delete().eq("id", id)); },
    async checkDelivery(id) {
      const { data, error } = await supabase.functions.invoke("campaign-send", { body: { campaign_id: id } });
      if (error) {
        let msg = error.message;
        try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return { configured: !!data.configured, recipients: data.recipients ?? 0, message: data.message ?? data.error ?? "" };
    },
    async listTokens() {
      return must(await db.from("agent_tokens").select("id,name,token_prefix,scopes,last_used_at,revoked_at,created_at").eq("workspace_id", w).order("created_at", { ascending: false }));
    },
    async createToken(name, scopes) {
      const token = generateToken();
      must(await db.from("agent_tokens").insert({ workspace_id: w, created_by: userId, name, scopes, token_hash: await hashToken(token), token_prefix: tokenPrefix(token) }));
      return token;
    },
    async revokeToken(id) { must(await db.from("agent_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id)); },
  };
}

// ---------- Public form access (no workspace session) ----------

export const isDemoId = (id: string) => id.startsWith("demo_");

export async function getPublicForm(id: string): Promise<FormDefinition | null> {
  if (isDemoId(id)) {
    const { demoPublicForm } = await import("./demo");
    return demoPublicForm(id);
  }
  const { data: form } = await (supabase as any).from("forms").select("id,status,published_version_id").eq("id", id).eq("status", "published").maybeSingle();
  if (!form?.published_version_id) return null;
  const { data: v } = await (supabase as any).from("form_versions").select("definition").eq("id", form.published_version_id).maybeSingle();
  return (v?.definition as FormDefinition) ?? null;
}

export interface SubmitResult { ok: boolean; error?: string; field_errors?: Record<string, string> }

export async function submitPublicForm(id: string, answers: Record<string, unknown>, contactName?: string): Promise<SubmitResult> {
  if (isDemoId(id)) {
    const { demoSubmit } = await import("./demo");
    return demoSubmit(id, answers, contactName);
  }
  const { error } = await supabase.functions.invoke("form-submit", { body: { form_id: id, answers, contact_name: contactName } });
  if (error) {
    try {
      const body = await (error as any).context.json();
      return { ok: false, error: body.error, field_errors: body.field_errors };
    } catch {
      return { ok: false, error: "We couldn't send your answers. Please try again." };
    }
  }
  return { ok: true };
}
