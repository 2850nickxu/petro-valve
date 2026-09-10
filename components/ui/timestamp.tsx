"use client";

import { useEffect, useState } from "react";
import { theme } from "@bigcommerce/big-design-theme";

// Renders a deterministic absolute stamp on the server (from the ISO string, no clock)
// and enhances with a relative "· 2h ago" on the client after mount — so there's no
// hydration mismatch, and stale lists visibly age.

function relative(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.round((now - then) / 1000);
  const abs = Math.abs(secs);
  const suffix = secs < 0 ? "from now" : "ago";
  if (abs < 45) return "just now";
  const m = Math.round(abs / 60);
  if (m < 60) return `${m}m ${suffix}`;
  const h = Math.round(abs / 3600);
  if (h < 24) return `${h}h ${suffix}`;
  const d = Math.round(abs / 86400);
  return `${d}d ${suffix}`;
}

function absolute(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return iso.slice(0, 16).replace("T", " ");
}

export function Timestamp({ iso, relative: showRelative = true }: { iso?: string | null; relative?: boolean }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!showRelative) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [showRelative]);

  if (!iso) return <span style={{ color: theme.colors.secondary60 }}>—</span>;
  const rel = showRelative && now != null ? relative(iso, now) : "";
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }} title={iso}>
      {absolute(iso)}
      {rel ? <span style={{ color: theme.colors.secondary60 }}> · {rel}</span> : null}
    </span>
  );
}
