import { createHmac, timingSafeEqual } from "node:crypto";

// Verify a BigCommerce signed_payload_jwt (load / uninstall / remove_user callbacks).
// HS256 signed with the app client secret. Claims: aud=clientId, iss="bc",
// sub="stores/{hash}". (Verified via docs MCP: .../apps/guide/handling-callbacks.)

export interface SignedPayload {
  storeHash: string;
  user: { id: number; email: string };
  owner: { id: number; email: string };
  url?: string;
  channelId?: number | null;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verifySignedPayloadJwt(
  token: string,
  clientId: string,
  clientSecret: string,
  now: number = Date.now(),
): SignedPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const expected = createHmac("sha256", clientSecret).update(`${headerB64}.${payloadB64}`).digest();
  const actual = b64urlToBuffer(sigB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let claims: {
    aud?: string;
    iss?: string;
    exp?: number;
    sub?: string;
    user?: { id: number; email: string };
    owner?: { id: number; email: string };
    url?: string;
    channel_id?: number | null;
  };
  try {
    claims = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  if (claims.iss !== "bc") return null;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp === "number" && claims.exp * 1000 < now) return null;

  const storeHash = String(claims.sub ?? "").replace(/^stores\//, "");
  if (!storeHash || !claims.user || !claims.owner) return null;

  return {
    storeHash,
    user: claims.user,
    owner: claims.owner,
    url: claims.url,
    channelId: claims.channel_id ?? null,
  };
}
