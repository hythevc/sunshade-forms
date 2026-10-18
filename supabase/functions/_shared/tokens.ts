// Agent token generation and hashing. Only SHA-256 hashes are stored;
// plaintext tokens are shown once at creation time.

export const TOKEN_PREFIX = "snt_";
export const TOKEN_BODY_LENGTH = 40;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BODY_LENGTH);
  crypto.getRandomValues(bytes);
  let body = "";
  for (let i = 0; i < bytes.length; i++) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return TOKEN_PREFIX + body;
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 4);
}
