import { timingSafeEqual } from "node:crypto";

// Constant-time verification for inbound webhook routes. Accepts either a `?token=` query
// secret or a `Bearer` Authorization header matching PO_AGENT_INBOUND_SECRET.

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyInboundSecret(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token && timingSafeEqualStr(token, secret)) return true;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(bearer) && timingSafeEqualStr(bearer, secret);
}

/** Decode a Pub/Sub push envelope → the Gmail notification { emailAddress, historyId }. */
export function decodePubSubGmail(body: unknown): { emailAddress?: string; historyId?: string } | null {
  const data = (body as { message?: { data?: string } })?.message?.data;
  if (!data) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
}
