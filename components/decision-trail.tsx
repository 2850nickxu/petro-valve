import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/backbone";
import { formatMoney } from "@/components/ui/money";
import type { AdminLinks } from "@/lib/bc/admin-links";
import { stamp, type TrailRun, type TrailStep } from "@/lib/po-agent/session-view";
import type { SourceRef, StepSetting } from "@/lib/po-agent/types";
import { isDefaultActor } from "@/lib/po-agent/people";

// The decision trail: every step the agent (or a person) took on a session, numbered and
// grouped by run, each saying what happened, which setting drove it, what data it read and
// how it came out. Rendered from stored decision steps only. Server-safe (no hooks).

const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  maxWidth: "100%",
  minHeight: 20,
  padding: "1px 7px",
  borderRadius: "var(--radius-md)",
  border: "var(--border-w) solid var(--border-default)",
  background: "var(--surface-panel)",
  fontSize: 11,
  lineHeight: "16px",
  color: "var(--text-secondary)",
  textDecoration: "none",
  overflowWrap: "anywhere",
};

const linkedChip: CSSProperties = { ...chip, color: "var(--text-link)" };

function sourceValue(s: SourceRef, currency?: string): string | undefined {
  if (s.value == null || s.value === "") return undefined;
  if ((s.type === "price" || s.type === "order") && typeof s.value === "number") return formatMoney(s.value, currency);
  return String(s.value);
}

/** Where a source chip goes: the BigCommerce record, the message in the thread, or Settings. */
function sourceHref(s: SourceRef, links: AdminLinks | null): { href: string; external: boolean } | undefined {
  const id = s.id ? Number(s.id) : NaN;
  if (s.type === "message" && s.id) return { href: `#msg-${s.id}`, external: false };
  if (s.type === "setting") return { href: "/staff/settings", external: false };
  if (!links || !Number.isFinite(id)) return undefined;
  if (s.type === "customer") return { href: links.customer(id), external: true };
  if (s.type === "order") return { href: links.order(id), external: true };
  return undefined;
}

function SourceChip({ source, links, currency }: { source: SourceRef; links: AdminLinks | null; currency?: string }) {
  const value = sourceValue(source, currency);
  const target = sourceHref(source, links);
  const title = source.readAt ? `Read ${stamp(source.readAt)} UTC` : undefined;
  const body = (
    <>
      <span>{source.label}</span>
      {value ? <span style={{ color: "var(--text-metadata)", ...num }}>· {value}</span> : null}
    </>
  );
  if (!target) {
    return (
      <span style={chip} title={title}>
        {body}
      </span>
    );
  }
  return (
    <a
      href={target.href}
      style={linkedChip}
      title={title}
      {...(target.external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {body}
    </a>
  );
}

function SettingChip({ setting }: { setting: StepSetting }) {
  return (
    <a href="/staff/settings" style={linkedChip}>
      <span>Setting: {setting.label}</span>
      <span style={{ color: "var(--text-metadata)", ...num }}>· {setting.value}</span>
    </a>
  );
}

function StepNumber({ n, tone }: { n: number; tone?: "neutral" | "warning" | "danger" }) {
  const signal = tone === "warning" || tone === "danger";
  return (
    <span
      aria-label={`Step ${n}`}
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 22,
        padding: "0 4px",
        borderRadius: "var(--radius-full)",
        border: `var(--border-w) solid ${signal ? `var(--${tone}-line)` : "var(--border-default)"}`,
        background: signal ? `var(--${tone}-tint)` : "var(--surface-sunken)",
        color: signal ? `var(--${tone}-600)` : "var(--text-secondary)",
        fontSize: 11,
        fontWeight: 600,
        ...num,
      }}
    >
      {n}
    </span>
  );
}

function Step({ step, last, links, currency }: { step: TrailStep; last: boolean; links: AdminLinks | null; currency?: string }) {
  const hasChips = step.setting || step.sources.length > 0 || step.outcome;
  return (
    <li id={`step-${step.n}`} style={{ display: "flex", gap: "var(--space-2-5)", scrollMarginTop: 72 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <StepNumber n={step.n} tone={step.outcome?.tone} />
        {last ? null : <span aria-hidden="true" style={{ width: 1, flex: "1 1 auto", minHeight: 12, background: "var(--border-default)" }} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1, paddingBottom: last ? 0 : "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {step.stage ? (
            <span
              style={{
                fontSize: "var(--text-label-size)",
                fontWeight: "var(--text-label-weight)",
                letterSpacing: "var(--text-label-tracking)",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {step.stage}
            </span>
          ) : null}
          <span style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--text-primary)" }}>{step.title}</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {stamp(step.at)}
          </span>
        </div>
        {step.summary ? (
          <span style={{ fontSize: "var(--text-caption-size)", lineHeight: "var(--text-caption-line)", color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
            {step.summary}
          </span>
        ) : null}
        {step.note ? (
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
            “{step.note}”{step.actor ? <span style={{ color: "var(--text-metadata)" }}> — {step.actor}</span> : null}
          </span>
        ) : step.actor && !isDefaultActor(step.actor) ? (
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>By {step.actor}</span>
        ) : null}
        {hasChips ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 2 }}>
            {step.setting ? <SettingChip setting={step.setting} /> : null}
            {step.sources.map((s, i) => (
              <SourceChip key={i} source={s} links={links} currency={currency} />
            ))}
            {step.outcome ? <Badge tone={step.outcome.tone}>{step.outcome.label}</Badge> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function RunHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: "var(--space-1) 0 var(--space-3)" }}>
      <span
        style={{
          flex: "none",
          fontSize: "var(--text-label-size)",
          fontWeight: "var(--text-label-weight)",
          letterSpacing: "var(--text-label-tracking)",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {children}
      </span>
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
    </div>
  );
}

export function DecisionTrail({ runs, links, currency }: { runs: TrailRun[]; links: AdminLinks | null; currency?: string }) {
  if (!runs.length) {
    return <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-caption-size)" }}>No steps recorded for this session yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {runs.map((r) => (
        <section key={r.key} aria-label={r.label}>
          <RunHeader>{r.label}</RunHeader>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {r.steps.map((s, i) => (
              <Step key={s.n} step={s} last={i === r.steps.length - 1} links={links} currency={currency} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
