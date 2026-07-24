"use client";

import { useState } from "react";

export function GmailConnect({ origin }: { origin: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function registerWatch() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/staff/gmail/register-watch", { method: "POST" });
      const json = await res.json();
      setMsg(res.ok ? `Watch registered (expires ${json.expiresAt || "?"}).` : `Error: ${json.error ?? res.status}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <a className="btn primary" href="/api/gmail-oauth/start" target="_blank" rel="noreferrer">Connect Gmail</a>
        <button className="btn" onClick={registerWatch} disabled={busy}>{busy ? "…" : "Register watch"}</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        In Google Cloud, add <code>{origin}/api/gmail-oauth/callback</code> as an authorized redirect URI on your OAuth client,
        and point a Pub/Sub push subscription at <code>{origin}/api/po-agent/inbound/google?token=&lt;inbound secret&gt;</code>.
      </p>
    </div>
  );
}
