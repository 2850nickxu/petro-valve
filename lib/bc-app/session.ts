import { createHmac } from "node:crypto";

// Signed app-session cookie: `${storeHash}.${base64url(HMAC-SHA256(storeHash, secret))}`.
// Set on the /load callback (after BigCommerce verifies the user) so the admin can be
// opened inside the control-panel iframe without a separate staff password. Verified
// edge-side in middleware with Web Crypto.

export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signAppSession(storeHash: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(storeHash).digest();
  return `${storeHash}.${b64url(mac)}`;
}

export function verifyAppSession(value: string, secret: string): string | null {
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const storeHash = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = b64url(createHmac("sha256", secret).update(storeHash).digest());
  return expected === sig ? storeHash : null;
}
