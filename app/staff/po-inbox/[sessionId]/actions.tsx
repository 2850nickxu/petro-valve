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

  const btn = (action: string, label: string, color: string) => (
    <button
      onClick={() => run(action)}
      disabled={busy != null}
      style={{ padding: "8px 14px", background: color, color: "white", border: "none", borderRadius: 6, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
    >
      {busy === action ? "…" : label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {btn("force_order", "Force order", "#0a7")}
      {btn("force_quote", "Force quote", "#07a")}
      {btn("dismiss", "Dismiss", "#a33")}
      {msg && <span style={{ color: "#556" }}>{msg}</span>}
    </div>
  );
}
