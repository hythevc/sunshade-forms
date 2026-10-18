# Roadmap — Sunshade build

## Phase 0 — Foundation
- [ ] Enable Lovable Cloud (PostgreSQL + auth). Blocker: pending platform approval if tool requires it.
- [ ] Enable email/password auth.
- [ ] Rebrand: page title/meta, favicon, UI, README → Sunshade. Remove SubsBase newsletter-only claims, no fabricated customers/compliance claims.

## Phase 1 — Data model (migrations)
- [ ] workspaces + workspace_members (roles) — tenant isolation, roles in dedicated table
- [ ] forms + form_versions (draft vs published definitions) + templates
- [ ] responses (owner-only, validated server-side)
- [ ] contacts (dedup email, source, tags, subscription status, consent fields) + suppressions
- [ ] segments, campaigns
- [ ] agent tokens (hashed at rest, scopes) — never store plaintext

## Phase 2 — Auth + workspace
- [ ] /auth sign-in + sign-up pages, session handling
- [ ] Workspace creation, RLS tenant isolation, error display

## Phase 3 — Forms
- [ ] Forms list: create/edit/duplicate/publish/unpublish
- [ ] Builder: field types (short text, long text, email, number, single choice, multiple choice, rating, marketing-consent checkbox), reorder, required validation, theme, live preview
- [ ] Draft vs published separation
- [ ] Three templates (lead-gen, customer-feedback, event-registration)
- [ ] Public runner /f/:id (one question at a time, back/next, keyboard, progress, completed state)

## Phase 4 — Submissions
- [ ] Server-validated submission edge function; never expose tenant identity/secrets; contact upsert + source attribution; consent required for subscription

## Phase 5 — Responses + contacts
- [ ] Responses table with filters/search/counts, safe CSV download (formula-injection protection)
- [ ] Contacts: dedup, tags, consent metadata, search/filter, CSV import with preview + validation, unsubscribed-by-default
- [ ] Segments by tags/source/subscription

## Phase 6 — Campaigns
- [ ] Campaign composer: subject, preview text, body, segment picker, save draft, duplicate
- [ ] Recipient count = subscribed, unsuppressed contacts in segment only
- [ ] Provider adapter endpoint with sender/domain validation; sending disabled + visibly unconfigured until real provider exists; no simulated sends
- [ ] Unsubscribe token endpoint + suppression (can't be reset by form spam)

## Phase 7 — Integrations (MCP)
- [ ] Authenticated MCP endpoint: initialize, notifications/initialized, tools/list, tools/call
- [ ] Tools: list_forms, get_form_responses, list_contacts, create_form_draft, create_campaign_draft (draft-only, no publish/send)
- [ ] Token UI: random, shown once, hashed, revocable, scoped
- [ ] Copyable client config + docs + live/setup status

## Phase 8 — Pricing + settings
- [ ] Beta pricing: Free €0 (3 forms/100 responses/500 contacts), Growth €19 (20/2,000/5,000), Team €39 (100/10,000/20,000)
- [ ] Billing/settings page with accurate usage; paid plans "coming soon" (Stripe unconfigured); document Stripe setup in README

## Phase 9 — Quality
- [ ] Tests: submission validation, consent preservation, unsubscribe suppression, CSV escaping, MCP auth/tenant isolation
- [ ] Build + typecheck + tests green
- [ ] README: deployment, env vars, architecture, provenance, features, honest gaps, strategy note
- [ ] Real empty states, keyboard accessibility, responsive sidebar, mobile
