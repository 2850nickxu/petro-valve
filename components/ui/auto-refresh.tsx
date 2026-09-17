"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@/components/backbone";

// Keeps a server-rendered list fresh: periodic router.refresh() plus a manual button and an
// "updated Xs ago" readout, so operators aren't looking at a stale snapshot. Per the
// Backbone loading rules, a refresh keeps the rows on screen and shows a small toolbar
// spinner — it never falls back to a skeleton.

export function AutoRefresh({ intervalMs = 15_000, label = "Refresh" }: { intervalMs?: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setLastAt(Date.now());
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    const refresh = setInterval(() => {
      router.refresh();
      setLastAt(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [intervalMs, router]);

  function manual() {
    setBusy(true);
    router.refresh();
    setLastAt(Date.now());
    setTimeout(() => setBusy(false), 400);
  }

  const ago = lastAt != null && now != null ? Math.round((now - lastAt) / 1000) : null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2-5)", flexWrap: "wrap" }}>
      <Button type="button" variant="ghost" size="micro" onClick={manual} disabled={busy} icon="sort">
        {busy ? "Refreshing…" : label}
      </Button>
      {busy ? <Spinner size={14} /> : null}
      {ago != null && !busy ? (
        <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
          updated {ago < 5 ? "just now" : `${ago}s ago`}
        </span>
      ) : null}
    </span>
  );
}
