import { bcAppCreds } from "@/lib/bc-app/config";
import { saveStoreInstall } from "@/lib/bc-app/store-tokens";
import { appPage } from "@/lib/bc-app/html";

// OAuth install callback (GET /api/bc-app/auth). BigCommerce redirects here with
// ?code&scope&context on install; we exchange the code for a permanent access token and
// persist it keyed by store hash. This is the "Auth Callback URL" in the dev portal.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const creds = bcAppCreds();
  if (!creds) return appPage("Not configured", `<h1>App not configured</h1><p class="muted">Set BC_APP_CLIENT_ID and BC_APP_CLIENT_SECRET.</p>`, 500);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope");
  const context = url.searchParams.get("context");
  if (!code || !context) return appPage("Install error", `<h1 class="bad">Install failed</h1><p class="muted">Missing code or context.</p>`, 400);

  // redirect_uri must exactly match the registered Auth Callback URL (this endpoint).
  const redirectUri = `${url.origin}${url.pathname}`;

  const res = await fetch("https://login.bigcommerce.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      scope,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      context,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    context?: string;
    user?: { email?: string };
    owner?: { email?: string };
  };
  if (!res.ok || !json.access_token) {
    return appPage("Install error", `<h1 class="bad">Token exchange failed</h1><p class="muted">${res.status}</p>`, 502);
  }

  const storeHash = String(json.context ?? context).replace(/^stores\//, "");
  const saved = await saveStoreInstall({
    storeHash,
    accessToken: json.access_token,
    scope: json.scope,
    ownerEmail: json.owner?.email,
    userEmail: json.user?.email,
    installedAt: new Date().toISOString(),
  });

  return appPage(
    "Installed",
    `<h1 class="ok">PO Agent installed</h1>
     <p>Connected to store <code>${storeHash}</code>${json.owner?.email ? ` for <code>${json.owner.email}</code>` : ""}.</p>
     ${saved ? "" : `<p class="bad">Warning: could not persist the token (Redis not configured) — set UPSTASH_REDIS_REST_URL/TOKEN.</p>`}
     <p class="muted">You can now open the app from your BigCommerce control panel.</p>`,
  );
}
