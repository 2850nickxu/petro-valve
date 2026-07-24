"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SessionActions({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(action: string) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setMsg(res.ok ? `Done: ${json.state ?? "ok"}` : `Error: ${json.error ?? res.status}`);
      if (res.ok) router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="toolbar">
      <button className="btn primary" onClick={() => run("force_order")} disabled={busy != null}>
        {busy === "force_order" ? "…" : "Force order"}
      </button>
      <button className="btn" onClick={() => run("force_quote")} disabled={busy != null}>
        {busy === "force_quote" ? "…" : "Force quote"}
      </button>
      <button className="btn danger" onClick={() => run("dismiss")} disabled={busy != null}>
        {busy === "dismiss" ? "…" : "Dismiss"}
      </button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
