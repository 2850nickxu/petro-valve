import { NextResponse } from "next/server";
import { bcAppCreds } from "./config";
import { verifySignedPayloadJwt } from "./jwt";
import { signAppSession } from "./session";
import { appPage } from "./html";

// Shared handler for App Extension load callbacks. BigCommerce opens the extension URL in
// a panel iframe with ?signed_payload_jwt (the resolved ${id} is in the URL path). Verify
// it, set the app-session cookie, and redirect to the (gated) panel page.

export function handleExtension(req: Request, panelPath: string): Response {
  const creds = bcAppCreds();
  if (!creds) return appPage("Not configured", `<h1 class="bad">App not configured</h1>`, 500);

  const url = new URL(req.url);
  const jwt = url.searchParams.get("signed_payload_jwt");
  const payload = jwt ? verifySignedPayloadJwt(jwt, creds.clientId, creds.clientSecret) : null;
  if (!payload) return appPage("Access error", `<h1 class="bad">Invalid signed payload</h1>`, 401);

  const session = signAppSession(payload.storeHash, creds.clientSecret);
  const res = NextResponse.redirect(new URL(panelPath, url.origin));
  res.cookies.set("poa_app", session, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
