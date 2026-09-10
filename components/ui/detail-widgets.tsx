import { Fragment, type ReactNode } from "react";
import styled from "styled-components";
import { theme } from "@bigcommerce/big-design-theme";
import type { Colors } from "@bigcommerce/big-design-theme";

// Bespoke, presentation-only widgets the PO inbox detail screens need that Big Design has
// no equivalent for: the audit-trail timeline, key/value blocks, the AI-extraction card,
// the escalation callout, and status dots. Visuals are ported from the old Silk stylesheet's
// rules (the timeline row, key/value block, AI-extraction card, escalation callout, and
// status dot classes — since removed); every color here reads from the Big Design theme,
// never from the old CSS custom properties.

/* ---------------------------------------------------------------- StatusDot */

export type StatusTone = "ok" | "bad" | "warn" | "sage" | "sky";

/** Nearest Big Design token for each of the old five dot colors. "sage" (routine pipeline
 * events) and "sky" (informational actions) have no direct Big Design equivalent, so they
 * borrow secondary/primary the same way the rest of this migration maps them. */
const DOT_COLOR: Record<StatusTone, keyof Colors> = {
  ok: "success40",
  bad: "danger40",
  warn: "warning40",
  sage: "secondary40",
  sky: "primary40",
};

const Dot = styled.span<{ $tone: StatusTone }>`
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => theme.colors[DOT_COLOR[p.$tone]]};
`;

export function StatusDot({ tone }: { tone: StatusTone }) {
  return <Dot $tone={tone} aria-hidden="true" />;
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

const TimelineRow = styled.div`
  display: flex;
  gap: ${theme.spacing.small};
  align-items: baseline;
  padding-bottom: ${theme.spacing.small};

  &:last-child {
    padding-bottom: 0;
  }
`;

const TimelineDotWrap = styled.span`
  align-self: center;
  display: inline-flex;
`;

const TimelineText = styled.div`
  min-width: 0;
  font-size: 12.5px;
`;

const TimelineTitle = styled.strong`
  color: ${theme.colors.secondary70};
  font-variant-numeric: tabular-nums;
`;

const TimelineTag = styled.span`
  display: inline-block;
  background: ${theme.colors.secondary10};
  border: 1px solid ${theme.colors.secondary20};
  border-radius: 3px;
  padding: 2px 8px;
  margin: 0 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: ${theme.colors.secondary60};
`;

const TimelineDetail = styled.span`
  color: ${theme.colors.secondary60};
`;

const TimelineAt = styled.div`
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: ${theme.colors.secondary50};
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
`;

/** Audit-trail / pipeline-step list — a status dot, event text, and a right-aligned time. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div>
      {items.map((it) => (
        <TimelineRow key={it.key}>
          <TimelineDotWrap>
            <StatusDot tone={it.tone} />
          </TimelineDotWrap>
          <TimelineText>
            <TimelineTitle>{it.title}</TimelineTitle>
            {it.tag ? <TimelineTag>{it.tag}</TimelineTag> : null}
            {it.detail ? <TimelineDetail>{it.detail}</TimelineDetail> : null}
          </TimelineText>
          {it.time ? <TimelineAt>{it.time}</TimelineAt> : null}
        </TimelineRow>
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

const GridKV = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 200px) 1fr;
  gap: 8px ${theme.spacing.medium};
  font-size: 12.5px;
`;

const GridKVLabel = styled.span`
  color: ${theme.colors.secondary60};
`;

const LinesKV = styled.div`
  font-size: 12.5px;
  line-height: 2;
`;

const LinesKVLabel = styled.span`
  color: ${theme.colors.warning70};
`;

/**
 * Two label/value layouts: "grid" (the `.kv` two-column table — Result, Original email) and
 * "lines" (the `.kv-lines` stacked "label · value" rows used inside `<AiCard>`).
 */
export function KeyValue({ rows, variant = "grid" }: { rows: KeyValueRow[]; variant?: "grid" | "lines" }) {
  if (variant === "lines") {
    return (
      <LinesKV>
        {rows.map((r) => (
          <div key={r.key}>
            <LinesKVLabel>{r.label}</LinesKVLabel> · {r.value}
          </div>
        ))}
      </LinesKV>
    );
  }
  return (
    <GridKV>
      {rows.map((r) => (
        <Fragment key={r.key}>
          <GridKVLabel>{r.label}</GridKVLabel>
          <span>{r.value}</span>
        </Fragment>
      ))}
    </GridKV>
  );
}

/* ---------------------------------------------------------------- AiCard */

const AiCardRoot = styled.div`
  background: ${theme.colors.warning10};
  border: 1px solid ${theme.colors.warning30};
  border-radius: ${theme.borderRadius.normal};
`;

const AiCardHead = styled.div`
  display: flex;
  align-items: center;
  gap: ${theme.spacing.small};
  padding: 12px 16px;
  border-bottom: 1px solid ${theme.colors.warning30};
`;

const AiTag = styled.span`
  display: inline-block;
  flex: none;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${theme.colors.white};
  background: ${theme.colors.warning60};
  padding: 3px 7px;
  border-radius: 2px;
`;

const AiCardTitle = styled.span`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${theme.colors.warning70};
`;

const AiCardBody = styled.div`
  padding: 13px 16px;
`;

/** The xanthous "AI extraction" card — an AI tag, a title, and arbitrary body content
 * (typically a `<KeyValue variant="lines">`). */
export function AiCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <AiCardRoot>
      <AiCardHead>
        <AiTag>AI</AiTag>
        <AiCardTitle>{title}</AiCardTitle>
      </AiCardHead>
      <AiCardBody>{children}</AiCardBody>
    </AiCardRoot>
  );
}

/* ---------------------------------------------------------------- Callout */

export type CalloutTone = "bad" | "warn" | "ok" | "info";

const CALLOUT_TONE: Record<CalloutTone, { bg: keyof Colors; border: keyof Colors; title: keyof Colors }> = {
  bad: { bg: "danger10", border: "danger40", title: "danger" },
  warn: { bg: "warning10", border: "warning40", title: "warning70" },
  ok: { bg: "success10", border: "success40", title: "success70" },
  info: { bg: "primary10", border: "primary40", title: "secondary70" },
};

const CalloutRoot = styled.div<{ $tone: CalloutTone }>`
  border-radius: ${theme.borderRadius.normal};
  padding: 13px 16px;
  border: 1px solid ${(p) => theme.colors[CALLOUT_TONE[p.$tone].border]};
  border-left-width: 4px;
  background: ${(p) => theme.colors[CALLOUT_TONE[p.$tone].bg]};
`;

const CalloutTitle = styled.div<{ $tone: CalloutTone }>`
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: ${(p) => theme.colors[CALLOUT_TONE[p.$tone].title]};
`;

const CalloutBody = styled.div`
  font-size: 12.5px;
  color: ${theme.colors.secondary70};
  margin-top: 4px;
  line-height: 1.6;
`;

/** Left-ruled callout (the escalation-reason box on the session detail page). */
export function Callout({ tone, title, children }: { tone: CalloutTone; title: ReactNode; children?: ReactNode }) {
  return (
    <CalloutRoot $tone={tone}>
      {title ? <CalloutTitle $tone={tone}>{title}</CalloutTitle> : null}
      {children ? <CalloutBody>{children}</CalloutBody> : null}
    </CalloutRoot>
  );
}
