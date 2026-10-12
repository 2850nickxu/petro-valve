import { NextResponse } from "next/server";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { appPage } from "@/lib/bc-app/html";

// Begin the in-app Gmail OAuth consent (replaces the local consent script). Uses the
// Gmail client id/secret from Settings; the merchant just needs a Google OAuth client
// whose authorized redirect URI is {app}/api/gmail-oauth/callback.

export const runtime = "nodejs";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hash = await sessionStoreHash();
  const env = await effectiveEnv(hash ?? undefined);
  const clientId = env.GOOGLE_PO_CLIENT_ID;
  if (!clientId) {
    return appPage("Not configured", `<h1 class="bad">Gmail client id not set</h1><p class="muted">Enter the Gmail OAuth client id &amp; secret in Settings → Email channel first.</p>`, 400);
  }
  const redirectUri = `${url.origin}/api/gmail-oauth/callback`;
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES.join(" "),
    }).toString();
  return NextResponse.redirect(authUrl);
}
