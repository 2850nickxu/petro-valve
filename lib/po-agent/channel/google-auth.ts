// Mint a Gmail API access token from a stored OAuth refresh token (server-side, for a
// single shared mailbox). No user interaction — the refresh token is obtained once via
// scripts/po-agent-google-consent.mjs.

export interface GoogleOAuthCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function googleCredsFromEnv(env: Record<string, string | undefined> = process.env): GoogleOAuthCreds | null {
  const clientId = env.GOOGLE_PO_CLIENT_ID;
  const clientSecret = env.GOOGLE_PO_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_PO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function mintAccessToken(creds: GoogleOAuthCreds): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}
