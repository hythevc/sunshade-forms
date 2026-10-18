// Shared Sunshade domain types and pure logic (no runtime dependencies).
// Used by edge functions (Deno) and unit tests (Node/vitest).

export type FieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "number"
  | "single_choice"
  | "multiple_choice"
  | "rating"
  | "consent";

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  max_rating?: number;
  consent_version?: string;
}

export interface FormTheme {
  accent?: string;
  background?: string;
  font?: "serif" | "sans";
}

export interface FormDefinition {
  title: string;
  description?: string;
  capture_contact?: boolean;
  fields: FormField[];
  theme?: FormTheme;
}

export const MAX_TEXT_LENGTH = 2000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DEFAULT_CONSENT_VERSION = "v1";

export type AnswerValue = string | number | boolean | string[] | null;

export interface ValidationResult {
  ok: boolean;
  /** Field id -> human readable error */
  errors: Record<string, string>;
  /** Normalized answers keyed by field id (consent coerced to boolean). */
  normalized: Record<string, AnswerValue>;
  /** True when any consent field was explicitly checked. */
  wantsConsent: boolean;
  /** Consent version of the (first) consent field, if consent was given. */
  consentVersion: string | null;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function validateSubmission(
  definition: FormDefinition,
  answers: Record<string, unknown> | undefined | null,
): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized: Record<string, AnswerValue> = {};
  const input = answers && typeof answers === "object" ? answers : {};
  let wantsConsent = false;
  let consentVersion: string | null = null;

  for (const field of definition.fields ?? []) {
    const raw = input[field.id];

    if (field.type === "consent") {
      // Consent must be an explicit boolean true. Absent/false means no consent.
      const checked = raw === true;
      if (field.required && !checked) {
        errors[field.id] = "This consent is required to continue.";
      }
      normalized[field.id] = checked;
      if (checked) {
        wantsConsent = true;
        consentVersion = field.consent_version ?? DEFAULT_CONSENT_VERSION;
      }
      continue;
    }

    if (isEmpty(raw)) {
      if (field.required) errors[field.id] = "This field is required.";
      else normalized[field.id] = null;
      continue;
    }

    switch (field.type) {
      case "short_text":
      case "long_text": {
        if (typeof raw !== "string") {
          errors[field.id] = "Please enter text.";
          break;
        }
        const value = raw.trim();
        if (value.length > MAX_TEXT_LENGTH) {
          errors[field.id] = `Please keep it under ${MAX_TEXT_LENGTH} characters.`;
          break;
        }
        normalized[field.id] = value;
        break;
      }
      case "email": {
        if (typeof raw !== "string" || !EMAIL_RE.test(raw.trim())) {
          errors[field.id] = "Please enter a valid email address.";
          break;
        }
        normalized[field.id] = raw.trim().toLowerCase();
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
        if (!Number.isFinite(n)) {
          errors[field.id] = "Please enter a number.";
          break;
        }
        normalized[field.id] = n;
        break;
      }
      case "single_choice": {
        if (typeof raw !== "string" || !(field.options ?? []).includes(raw)) {
          errors[field.id] = "Please choose one of the listed options.";
          break;
        }
        normalized[field.id] = raw;
        break;
      }
      case "multiple_choice": {
        const arr = Array.isArray(raw) ? raw : null;
        if (!arr || arr.some((v) => typeof v !== "string" || !(field.options ?? []).includes(v))) {
          errors[field.id] = "Please choose only the listed options.";
          break;
        }
        normalized[field.id] = arr;
        break;
      }
      case "rating": {
        const max = field.max_rating ?? 5;
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n < 1 || n > max) {
          errors[field.id] = `Please pick a rating from 1 to ${max}.`;
          break;
        }
        normalized[field.id] = n;
        break;
      }
      default:
        errors[field.id] = "Unsupported field type.";
    }
  }

  // Reject unknown keys outright so hidden fields can't smuggle data.
  const known = new Set((definition.fields ?? []).map((f) => f.id));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors[key] = errors[key] ?? "Unknown field.";
  }

  return { ok: Object.keys(errors).length === 0, errors, normalized, wantsConsent, consentVersion };
}
