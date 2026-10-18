import { EMAIL_RE } from "./shared";

/** Minimal RFC4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportRow { line: number; email: string; name: string; tags: string[]; error?: string }

export function prepareImport(text: string, existing: Set<string>, max = 5000): ImportRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const ei = header.indexOf("email");
  const ni = header.indexOf("name");
  const ti = header.indexOf("tags");
  const seen = new Set<string>();
  return rows.slice(1, max + 1).map((r, idx) => {
    const email = (ei >= 0 ? r[ei] : "")?.trim() ?? "";
    const norm = email.toLowerCase();
    const out: ImportRow = {
      line: idx + 2,
      email,
      name: ((ni >= 0 ? r[ni] : "") ?? "").trim().slice(0, 200),
      tags: ((ti >= 0 ? r[ti] : "") ?? "").split(/[;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20),
    };
    if (ei < 0) out.error = "No 'email' column";
    else if (!EMAIL_RE.test(email) || email.length > 254) out.error = "Invalid email";
    else if (seen.has(norm)) out.error = "Duplicate in file";
    else if (existing.has(norm)) out.error = "Already a contact";
    seen.add(norm);
    return out;
  });
}
