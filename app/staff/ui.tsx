import type { ReactNode } from "react";
import Link from "next/link";

// Server-safe presentational primitives shared by the admin screens. Every class here is
// defined in globals.css against the design tokens — no inline styling of design values.

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pa-pagehead">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children ? <div className="pa-wrap spacer">{children}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
  compact,
  hint,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "ok" | "bad";
  compact?: boolean;
  hint?: string;
}) {
  return (
    <div className={`stat${compact ? " compact" : ""}`} title={hint}>
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ""}`}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

/** State/decision chip. `kind` maps to the session state or decision kind. */
export function Chip({ kind, size, children }: { kind?: string; size?: "lg" | "sm"; children?: ReactNode }) {
  return <span className={`chip ${kind ?? "neutral"}${size ? ` ${size}` : ""}`}>{children ?? kind ?? "—"}</span>;
}

export function CardHead({ title, sm, children }: { title: ReactNode; sm?: boolean; children?: ReactNode }) {
  return (
    <div className={`card-head${sm ? " sm" : ""}`}>
      <span>{title}</span>
      {children}
    </div>
  );
}

export function HealthRow({
  ok,
  warn,
  name,
  detail,
  action,
}: {
  ok: boolean;
  warn?: boolean;
  name: string;
  detail?: ReactNode;
  /** Shown as a "fix it" link when the item isn't OK. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="pa-row">
      <span className={`dot-status ${ok ? "ok" : warn ? "warn" : "bad"}`} />
      <div className="pa-grow" style={{ flexBasis: 140 }}>
        <span className="r-title" style={{ color: "var(--head)", fontSize: 13 }}>{name}</span>
      </div>
      <span className="r-meta num">{detail}</span>
      {!ok && action ? (
        <Link className="btn xs" href={action.href}>{action.label}</Link>
      ) : null}
    </div>
  );
}

/** One clickable session line — used by the dashboard, inbox and sessions list. */
export function SessionRow({
  href,
  company,
  sub,
  meta,
  state,
  stateLabel,
  tint,
}: {
  href: string;
  company: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  state?: string;
  stateLabel?: string;
  tint?: "bad" | "warn";
}) {
  return (
    <Link href={href} className={`pa-row link${tint ? ` tint-${tint}` : ""}`}>
      <div className="pa-grow">
        <div className="r-title">{company}</div>
        {sub ? <div className="r-sub">{sub}</div> : null}
      </div>
      {meta ? <span className="r-meta num">{meta}</span> : null}
      {state ? <Chip kind={state}>{stateLabel ?? state}</Chip> : null}
    </Link>
  );
}

/** Human label for a session state, matching the design's chip copy. */
export const STATE_LABEL: Record<string, string> = {
  new: "new",
  identifying: "identifying",
  validating: "validating",
  submitting: "submitting",
  clarifying: "clarifying",
  awaiting_confirmation: "awaiting confirm",
  completed_order: "order placed",
  completed_quote: "quote sent",
  escalated: "escalated",
  rejected: "rejected",
  expired: "expired",
};

export function stateLabel(state?: string): string {
  return (state && STATE_LABEL[state]) || state || "—";
}
