"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Keeps a server-rendered list fresh: periodic router.refresh() plus a manual button and
// an "updated Xs ago" readout, so operators aren't looking at a stale snapshot.

export function AutoRefresh({ intervalMs = 15_000, label = "Refresh" }: { intervalMs?: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setLastAt(Date.now());
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    const refresh = setInterval(() => { router.refresh(); setLastAt(Date.now()); }, intervalMs);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [intervalMs, router]);

  function manual() {
    setBusy(true);
    router.refresh();
    setLastAt(Date.now());
    setTimeout(() => setBusy(false), 400);
  }

  const ago = lastAt != null && now != null ? Math.round((now - lastAt) / 1000) : null;

  return (
    <div className="pa-wrap">
      <button className="btn xs" onClick={manual} disabled={busy}>{busy ? "Refreshing…" : label}</button>
      {ago != null && <span className="muted" style={{ fontSize: 12 }}>updated {ago < 5 ? "just now" : `${ago}s ago`}</span>}
    </div>
  );
}
