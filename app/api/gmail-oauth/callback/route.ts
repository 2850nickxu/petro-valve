import { cookies } from "next/headers";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { saveSettings, type SettingsScope } from "@/lib/po-agent/settings-store";
import { appPage } from "@/lib/bc-app/html";

// Gmail OAuth redirect target: exchange the code for a refresh token, discover the
// mailbox address, and persist both into Settings (so the agent can mint tokens + reply).

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const env = await effectiveEnv(hash ?? undefined);
  const clientId = env.GOOGLE_PO_CLIENT_ID;
  const clientSecret = env.GOOGLE_PO_CLIENT_SECRET;

  if (!code || !clientId || !clientSecret) {
    return appPage("Gmail error", `<h1 class="bad">Gmail connection failed</h1><p class="muted">Missing code or client credentials.</p>`, 400);
  }

  const redirectUri = `${url.origin}/api/gmail-oauth/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
    cache: "no-store",
  });
  const tok = (await tokenRes.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string };
  if (!tok.refresh_token) {
    return appPage("Gmail error", `<h1 class="bad">No refresh token returned</h1><p class="muted">Remove the app at myaccount.google.com/permissions and reconnect (consent must re-prompt).</p>`, 502);
  }

  let mailbox = "";
  try {
    const profRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    mailbox = ((await profRes.json()) as { emailAddress?: string }).emailAddress ?? "";
  } catch {
    /* mailbox optional */
  }

  const scope: SettingsScope = hash ? `store:${hash}` : "global";
  await saveSettings(scope, {
    GOOGLE_PO_REFRESH_TOKEN: tok.refresh_token,
    PO_AGENT_CHANNEL: "google",
    ...(mailbox ? { PO_AGENT_MAILBOX: mailbox } : {}),
  });

  return appPage(
    "Gmail connected",
    `<h1 class="ok">Gmail connected</h1>
     <p>Mailbox <code>${mailbox || "(unknown)"}</code> is now connected. Set a Pub/Sub topic in Settings and register the watch to start receiving POs.</p>
     <p><a class="btn" href="/staff/settings">Back to settings</a></p>`,
  );
}
