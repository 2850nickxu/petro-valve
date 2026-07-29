"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Banner } from "@/components/ui/states";

export function GmailConnect({ origin }: { origin: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [connectClicked, setConnectClicked] = useState(false);

  async function registerWatch() {
    setBusy(true);
    try {
      const res = await fetch("/api/staff/gmail/register-watch", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        toast.success(`Push subscription registered (expires ${json.expiresAt || "?"}).`);
      } else {
        toast.error(`Watch registration failed: ${json.error ?? res.status}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Watch registration failed");
    } finally {
      setBusy(false);
    }
  }

  function handleConnect() {
    setConnectClicked(true);
    window.open("/api/gmail-oauth/start", "_blank", "noreferrer");
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: connectClicked ? 10 : 0 }}>
        <button className="btn primary" onClick={handleConnect}>
          Connect Gmail
        </button>
        <button
          className="btn"
          onClick={registerWatch}
          disabled={busy}
          title="Registers a Gmail push watch so new emails are delivered to the inbound webhook via Pub/Sub"
        >
          {busy ? "Registering…" : "Register Pub/Sub watch"}
        </button>
      </div>

      {connectClicked && (
        <div style={{ marginBottom: 10 }}>
          <Banner kind="info">
            Complete the Google sign-in in the opened tab, then return here. The refresh token will
            be saved automatically.
          </Banner>
        </div>
      )}

      <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
        In Google Cloud, add{" "}
        <code>{origin}/api/gmail-oauth/callback</code> as an authorized redirect URI on your OAuth
        client, and point a Pub/Sub push subscription at{" "}
        <code>{origin}/api/po-agent/inbound/google?token=&lt;inbound secret&gt;</code>.
      </p>
    </div>
  );
}
