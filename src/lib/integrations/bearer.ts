/**
 * Parsing `Authorization: Bearer <token>` headers (pure). OWNED BY: Agent C.
 */

/** Extract the token from an Authorization header value; null if absent or not a Bearer credential. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  const token = m[1];
  if (token.length > 512) return null;
  return token;
}
