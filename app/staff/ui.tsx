import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, KpiCard, StatusDot } from "@/components/backbone";
import { badgeVariant } from "@/lib/ui/badge-variant";
import { LinkButton } from "@/components/ui/link-button";

// Server-safe presentational primitives shared by the admin screens, built on Backbone.
// No client hooks here, so async server pages can import them directly.

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  // Implemented directly (not via Backbone PageHeader) because some screens pass a rich
  // ReactNode subtitle, while PageHeader.description is a plain string. Type + spacing come
  // from tokens, so it reads identically to PageHeader.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--gap-within)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-title-size)",
            lineHeight: "var(--text-title-line)",
            fontWeight: "var(--text-title-weight)",
            letterSpacing: "var(--text-title-tracking)",
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h1>
        {sub ? (
          <div
            style={{
              fontSize: "var(--text-body-size)",
              lineHeight: "var(--text-body-line)",
              color: "var(--text-secondary)",
              maxWidth: "68ch",
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
      {children ? <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>{children}</div> : null}
    </div>
  );
}

/** A metric in a summary strip. Backbone's KpiCard keeps the value neutral by default;
 * where a value is itself a signal (a failure count), pass a toned value node. */
export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "ok" | "bad";
  /** Accepted for source compatibility; density is driven by the surrounding region. */
  compact?: boolean;
  hint?: string;
}) {
  const color = tone === "bad" ? "var(--danger-600)" : tone === "ok" ? "var(--success-600)" : undefined;
  const tonedValue = color ? <span style={{ color }}>{value}</span> : value;
  return <KpiCard label={label} value={tonedValue} note={typeof note === "string" ? note : undefined} />;
}

/** State/decision chip. `kind` maps to the session state or decision kind. */
export function Chip({ kind, children }: { kind?: string; size?: "lg" | "sm"; children?: ReactNode }) {
  return <Badge tone={badgeVariant(kind ?? "neutral")}>{children ?? kind ?? "—"}</Badge>;
}

export function CardHead({ title, children }: { title: ReactNode; sm?: boolean; children?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-2-5)",
        marginBottom: "var(--gap-within)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-subheading-size)",
          fontWeight: "var(--text-subheading-weight)",
          color: "var(--text-primary)",
        }}
      >
        {title}
      </span>
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
  const tone: "success" | "warning" | "danger" = ok ? "success" : warn ? "warning" : "danger";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-2-5)",
        paddingTop: "var(--space-2)",
        paddingBottom: "var(--space-2)",
      }}
    >
      <StatusDot tone={tone} halo={false} />
      <span style={{ flex: "1 1 140px", minWidth: 0, fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>{name}</span>
      {detail ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>{detail}</span> : null}
      {!ok && action ? (
        <LinkButton href={action.href} variant="ghost" size="micro">
          {action.label}
        </LinkButton>
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
  stateLabel: stateLabelProp,
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
  const bg = tint === "bad" ? "var(--danger-tint)" : tint === "warn" ? "var(--warning-tint)" : undefined;
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-2-5)",
        padding: "var(--space-3) var(--space-4)",
        background: bg,
        textDecoration: "none",
        color: "inherit",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ flex: "1 1 230px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>{company}</span>
        {sub ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>{sub}</span> : null}
      </span>
      {meta ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>{meta}</span> : null}
      {state ? <Chip kind={state}>{stateLabelProp ?? state}</Chip> : null}
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
