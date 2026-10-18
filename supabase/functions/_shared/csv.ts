// CSV serialization with spreadsheet-formula-injection protection.
// Pure logic shared by the app UI (CSV download/import) and unit tests.

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Escape a single CSV cell. Values that could be interpreted as formulas by
 * spreadsheet apps (leading = + - @ tab or CR) are prefixed with a single
 * quote so they open as text instead of executing.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_PREFIXES.some((p) => s.startsWith(p))) {
    s = "'" + s;
  }
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
