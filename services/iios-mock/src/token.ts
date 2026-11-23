/*
 * MOCK IIOS — sealed grant tokens (dev key only). The OGC API never sees the key and never calls
 * these functions: it presents the token to `/v1/grants/resolve` and honours the decided state
 * (OGC-DEC-027). Format: base64url(JSON payload) "." base64url(HMAC-SHA256(payload)).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface GrantPayload {
  v: 1;
  jti: string; // grant id (revocation)
  cid: string; // client the grant was issued to
  org: string;
  sub: string; // principal
  purpose: string;
  ac?: string; // active center (narrowing only)
  rid: string; // IIOS request id, for audit correlation
  iat: number; // seconds
  exp: number; // seconds
}

const b64 = (b: Buffer) => b.toString("base64url");

export function sign(
  key: Buffer,
  p: Omit<GrantPayload, "v" | "jti" | "rid">,
): {
  token: string;
  payload: GrantPayload;
} {
  const payload: GrantPayload = { v: 1, jti: randomUUID(), rid: `iios-req-${randomUUID()}`, ...p };
  const body = b64(Buffer.from(JSON.stringify(payload)));
  const mac = b64(createHmac("sha256", key).update(body).digest());
  return { token: `${body}.${mac}`, payload };
}

/** The payload when the token is well formed and its MAC matches; null otherwise. */
export function open(key: Buffer, token: string): GrantPayload | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const want = createHmac("sha256", key).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GrantPayload;
    if (p.v !== 1 || typeof p.sub !== "string" || typeof p.org !== "string") return null;
    if (typeof p.exp !== "number" || typeof p.jti !== "string") return null;
    return p;
  } catch {
    return null;
  }
}
