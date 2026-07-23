#!/usr/bin/env node
// One-time OAuth consent for the monitored Gmail mailbox. Dependency-free (loopback flow).
// Prints a GOOGLE_PO_REFRESH_TOKEN you paste into .env.local.
//
// Prereqs: a Google Cloud OAuth "Web application" client with redirect URI
// http://localhost:53682/oauth2callback. Then:
//   GOOGLE_PO_CLIENT_ID=... GOOGLE_PO_CLIENT_SECRET=... node scripts/po-agent-google-consent.mjs
// Sign in as the mailbox user and approve. Scopes: gmail.modify + gmail.send.

import http from "node:http";

const CLIENT_ID = process.env.GOOGLE_PO_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_PO_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_PO_CLIENT_ID and GOOGLE_PO_CLIENT_SECRET in the environment first.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES.join(" "),
  }).toString();

console.log("\nOpen this URL in a browser signed in as the mailbox user:\n");
console.log(authUrl + "\n");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing code");
    return;
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }).toString(),
    });
    const json = await tokenRes.json();
    res.writeHead(200, { "Content-Type": "text/plain" }).end("Done — you can close this tab and return to the terminal.");
    if (json.refresh_token) {
      console.log("\n✅ Add this to .env.local:\n");
      console.log(`GOOGLE_PO_REFRESH_TOKEN=${json.refresh_token}\n`);
    } else {
      console.error("\nNo refresh_token returned. Remove the app from https://myaccount.google.com/permissions and retry (prompt=consent).\n", json);
    }
  } catch (e) {
    console.error("Token exchange failed:", e);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => console.log(`Waiting for the OAuth redirect on ${REDIRECT} …`));
