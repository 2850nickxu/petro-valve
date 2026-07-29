import type { ReactNode } from "react";

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function Badge({ kind, children }: { kind?: string; children?: ReactNode }) {
  return <span className={`badge ${kind ?? "muted"}`}>{children ?? kind ?? "—"}</span>;
}

export function HealthRow({ ok, name, detail, warn, action }: {
  ok: boolean;
  name: string;
  detail?: ReactNode;
  warn?: boolean;
  /** Shown as a "fix it" link when the item isn't OK. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="row">
      <span className={`dot-status ${ok ? "ok" : warn ? "warn" : "bad"}`} />
      <span className="name">{name}</span>
      <span className="muted mono">{detail}</span>
      {!ok && action ? <a className="btn sm" href={action.href} style={{ marginLeft: 10 }}>{action.label}</a> : null}
    </div>
  );
}
