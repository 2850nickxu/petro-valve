import { NextResponse } from "next/server";
import { bcAppCreds } from "@/lib/bc-app/config";
import { verifySignedPayloadJwt } from "@/lib/bc-app/jwt";
import { deleteStoreInstall } from "@/lib/bc-app/store-tokens";

// Uninstall callback (GET /api/bc-app/uninstall). BigCommerce calls this when the app is
// uninstalled; we invalidate the stored token. BigCommerce auto-removes webhooks/App
// Extensions, so no platform cleanup is needed.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const creds = bcAppCreds();
  if (!creds) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const url = new URL(req.url);
  const token = url.searchParams.get("signed_payload_jwt");
  const payload = token ? verifySignedPayloadJwt(token, creds.clientId, creds.clientSecret) : null;
  if (!payload) return NextResponse.json({ error: "invalid signed payload" }, { status: 401 });

  await deleteStoreInstall(payload.storeHash);
  return NextResponse.json({ ok: true });
}
