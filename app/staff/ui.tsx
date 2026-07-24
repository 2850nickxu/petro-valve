import type { ReactNode } from "react";

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function Badge({ kind, children }: { kind?: string; children?: ReactNode }) {
  return <span className={`badge ${kind ?? "muted"}`}>{children ?? kind ?? "—"}</span>;
}

export function HealthRow({ ok, name, detail, warn }: { ok: boolean; name: string; detail?: ReactNode; warn?: boolean }) {
  return (
    <div className="row">
      <span className={`dot-status ${ok ? "ok" : warn ? "warn" : "bad"}`} />
      <span className="name">{name}</span>
      <span className="muted mono">{detail}</span>
    </div>
  );
}
