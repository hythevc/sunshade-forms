// Re-exports of the pure domain logic shared with backend functions, so the
// browser demo and the server enforce identical rules.
export * from "../../supabase/functions/_shared/types";
export { resolveContactUpdate } from "../../supabase/functions/_shared/consent";
export { buildCsv, escapeCsvCell } from "../../supabase/functions/_shared/csv";
export { generateToken, hashToken, tokenPrefix } from "../../supabase/functions/_shared/tokens";
