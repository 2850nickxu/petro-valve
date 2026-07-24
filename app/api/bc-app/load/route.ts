import { NextResponse } from "next/server";
import { bcAppCreds } from "@/lib/bc-app/config";
import { verifySignedPayloadJwt } from "@/lib/bc-app/jwt";
import { signAppSession } from "@/lib/bc-app/session";
import { appPage } from "@/lib/bc-app/html";

// Load callback (GET /api/bc-app/load). BigCommerce opens this in the control-panel iframe
// with ?signed_payload_jwt when a user launches the app. We verify it, set a signed
// app-session cookie, and hand off to the admin console. This is the "Load Callback URL".

export const runtime = "nodejs";

export async function GET(req: Request) {
  const creds = bcAppCreds();
  if (!creds) return appPage("Not configured", `<h1>App not configured</h1><p class="muted">Set BC_APP_CLIENT_ID and BC_APP_CLIENT_SECRET.</p>`, 500);

  const url = new URL(req.url);
  const token = url.searchParams.get("signed_payload_jwt");
  const payload = token ? verifySignedPayloadJwt(token, creds.clientId, creds.clientSecret) : null;
  if (!payload) return appPage("Access error", `<h1 class="bad">Invalid signed payload</h1>`, 401);

  // Signed app-session cookie → middleware allows /staff inside the iframe.
  const session = signAppSession(payload.storeHash, creds.clientSecret);
  const res = NextResponse.redirect(new URL("/staff", url.origin));
  res.cookies.set("poa_app", session, {
    httpOnly: true,
    secure: true,
    sameSite: "none", // required to be sent inside the BigCommerce iframe
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
