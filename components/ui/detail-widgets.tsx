import { Fragment, type ReactNode } from "react";
import { InlineMessage } from "@/components/backbone";

// App-specific, presentation-only widgets the PO inbox detail screens need. The Backbone kit has
// a Timeline and a FieldList, but the audit trail here carries a tone dot, an actor pill and
// a free-form detail per row, and the record's key/value blocks have their own layouts — so
// these are composed directly from Backbone tokens (the system explicitly allows building
// app widgets this way). Every colour is a token; nothing is hard-coded. The escalation
// callout maps to Backbone's InlineMessage. All server-safe (no client hooks).

/* ---------------------------------------------------------------- StatusDot */

export type StatusTone = "ok" | "bad" | "warn" | "sage" | "sky";

// The audit trail's five dot roles, mapped to signal/neutral tokens. "sage" (routine
// pipeline events) is neutral; "sky" (informational actions) is info.
const DOT_COLOR: Record<StatusTone, string> = {
  ok: "var(--success-500)",
  bad: "var(--danger-500)",
  warn: "var(--warning-500)",
  sage: "var(--gray-400)",
  sky: "var(--info-500)",
};

export function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", flex: "none", width: 8, height: 8, borderRadius: "var(--radius-full)", background: DOT_COLOR[tone] }}
    />
  );
}

/* ---------------------------------------------------------------- Timeline */

export interface TimelineItem {
  key: string | number;
  tone: StatusTone;
  /** Event name, e.g. "escalated". */
  title: ReactNode;
  /** Optional actor pill, e.g. "operator@silk.com". */
  tag?: ReactNode;
  /** Note or JSON detail for the event. */
  detail?: ReactNode;
  /** Right-aligned timestamp, e.g. "14:32". */
  time?: ReactNode;
}

/** Audit-trail / pipeline-step list — a status dot, event text, and a right-aligned time. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div>
      {items.map((it) => (
        <div
          key={it.key}
          style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", paddingBottom: "var(--space-2)" }}
        >
          <span style={{ alignSelf: "center", display: "inline-flex" }}>
            <StatusDot tone={it.tone} />
          </span>
          <div style={{ minWidth: 0, fontSize: "var(--text-caption-size)" }}>
            <strong style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{it.title}</strong>
            {it.tag ? (
              <span
                style={{
                  display: "inline-block",
                  background: "var(--surface-inset)",
                  border: "var(--border-w) solid var(--border-default)",
                  borderRadius: "var(--radius-sm)",
                  padding: "2px 8px",
                  margin: "0 6px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text-metadata)",
                }}
              >
                {it.tag}
              </span>
            ) : null}
            {it.detail ? <span style={{ color: "var(--text-metadata)", marginLeft: it.tag ? 0 : 6 }}>{it.detail}</span> : null}
          </div>
          {it.time ? (
            <div
              style={{
                marginLeft: "auto",
                flex: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {it.time}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- KeyValue */

export interface KeyValueRow {
  key: string | number;
  label: ReactNode;
  value: ReactNode;
}

/**
 * Two label/value layouts: "grid" (a two-column label/value table — Result, Original email)
 * and "lines" (stacked "label · value" rows, used inside <AiCard>).
 */
export function KeyValue({ rows, variant = "grid" }: { rows: KeyValueRow[]; variant?: "grid" | "lines" }) {
  if (variant === "lines") {
    return (
      <div style={{ fontSize: "var(--text-caption-size)", lineHeight: 2 }}>
        {rows.map((r) => (
          <div key={r.key}>
            <span style={{ color: "var(--text-metadata)" }}>{r.label}</span> · {r.value}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 200px) 1fr",
        gap: "8px var(--space-4)",
        fontSize: "var(--text-caption-size)",
      }}
    >
      {rows.map((r) => (
        <Fragment key={r.key}>
          <span style={{ color: "var(--text-metadata)" }}>{r.label}</span>
          <span style={{ color: "var(--text-primary)" }}>{r.value}</span>
        </Fragment>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- AiCard */

/** The AI-extraction block: an "AI extraction" label and arbitrary body content (typically a
 * <KeyValue variant="lines">). Rendered as a quiet Inset, not an alarm — the extraction is
 * provisional context, and colour in Backbone is reserved for things that need attention. */
export function AiCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: "var(--surface-inset)", border: "var(--border-w) solid var(--border-default)", borderRadius: "var(--radius-md)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "10px 16px",
          borderBottom: "var(--border-w) solid var(--border-default)",
        }}
      >
        <span
          style={{
            flex: "none",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent-on-surface)",
            background: "var(--accent-surface)",
            padding: "3px 7px",
            borderRadius: "var(--radius-sm)",
          }}
        >
          AI
        </span>
        <span
          style={{
            fontSize: "var(--text-label-size)",
            fontWeight: "var(--text-label-weight)",
            letterSpacing: "var(--text-label-tracking)",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ padding: "13px 16px" }}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- Callout */

export type CalloutTone = "bad" | "warn" | "ok" | "info";

const CALLOUT_TONE: Record<CalloutTone, "danger" | "warning" | "success" | "info"> = {
  bad: "danger",
  warn: "warning",
  ok: "success",
  info: "info",
};

/** The escalation-reason box — a Backbone InlineMessage carrying the tinted, titled callout. */
export function Callout({ tone, title, children }: { tone: CalloutTone; title: ReactNode; children?: ReactNode }) {
  return (
    <InlineMessage tone={CALLOUT_TONE[tone]} title={typeof title === "string" ? title : undefined} live={false}>
      {typeof title !== "string" ? title : null}
      {children}
    </InlineMessage>
  );
}
