import { NextResponse } from "next/server";
import { bcAppCreds } from "@/lib/bc-app/config";
import { verifySignedPayloadJwt } from "@/lib/bc-app/jwt";

// Remove-user callback (GET /api/bc-app/remove_user). Fires when a store owner revokes a
// user's access to the app (multi-user apps). Single-user here — we just verify + ack.
// This is the "Remove User Callback URL" in the dev portal.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const creds = bcAppCreds();
  if (!creds) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const url = new URL(req.url);
  const token = url.searchParams.get("signed_payload_jwt");
  const payload = token ? verifySignedPayloadJwt(token, creds.clientId, creds.clientSecret) : null;
  if (!payload) return NextResponse.json({ error: "invalid signed payload" }, { status: 401 });

  // No per-user records to purge in the single-user model.
  return NextResponse.json({ ok: true });
}
