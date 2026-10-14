import type { CSSProperties } from "react";
import { Badge } from "@/components/backbone";
import { formatMoney } from "@/components/ui/money";
import { REASON_TEXT, scenarioLabel } from "@/lib/po-agent/rules/catalog";
import type { DecisionRecord, RulesAction, RulesLineStatus } from "@/lib/po-agent/rules/types";

// The rules' decision record for one customer message (doc §7): the action, the scenarios
// that matched, the reason codes, the note for the rep and each line's status. For an
// escalation this is the handoff a person picks up. Server-safe (no hooks).

type Tone = "neutral" | "success" | "warning" | "danger";

export const ACTION_LABEL: Record<RulesAction, string> = {
  AUTO_RESPOND: "Auto-respond",
  CLARIFY: "Clarify",
  HOLD: "Hold for review",
  ESCALATE: "Escalate",
  NO_RESPONSE: "No response",
};

export const ACTION_TONE: Record<RulesAction, Tone> = {
  AUTO_RESPOND: "success",
  CLARIFY: "warning",
  HOLD: "warning",
  ESCALATE: "danger",
  NO_RESPONSE: "neutral",
};

const LINE_TONE: Record<RulesLineStatus, Tone> = { ok: "neutral", clarify: "warning", hold: "warning", escalate: "danger" };

const REPLY_TEXT: Record<DecisionRecord["reply_status"], string> = {
  sent: "Reply sent (captured by the simulator)",
  held: "Reply held for review",
  preview: "Reply previewed, not sent",
  none: "No reply",
};

const caption: CSSProperties = { fontSize: "var(--text-caption-size)", lineHeight: "var(--text-caption-line)", color: "var(--text-metadata)" };
const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };
const label: CSSProperties = {
  fontSize: "var(--text-label-size)",
  fontWeight: "var(--text-label-weight)" as CSSProperties["fontWeight"],
  letterSpacing: "var(--text-label-tracking)",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={label}>{title}</span>
      {children}
    </div>
  );
}

export function DecisionRecordView({ record, currency }: { record: DecisionRecord; currency?: string }) {
  const scenarios = record.matched_scenarios;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <Badge tone={ACTION_TONE[record.action]}>{ACTION_LABEL[record.action]}</Badge>
        <span style={caption}>
          {record.intent.type.replace("_", " ")} · {Math.round(record.intent.confidence * 100)}% confident ·{" "}
          {record.customer.guest ? "guest" : record.customer.company || "known customer"} · {REPLY_TEXT[record.reply_status]}
        </span>
      </div>

      <span style={{ fontSize: "var(--text-body-size)", color: "var(--text-primary)" }}>{record.notes_for_rep}</span>

      {record.reason_codes.length ? (
        <Row title="Reason codes">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {record.reason_codes.map((c) => (
              <Badge key={c} tone="neutral" mono>
                {c}
              </Badge>
            ))}
          </div>
          <span style={caption}>{record.reason_codes.map((c) => REASON_TEXT[c]).join(" · ")}</span>
        </Row>
      ) : null}

      <Row title="Scenarios">
        <span style={{ ...caption, color: "var(--text-secondary)" }}>
          {scenarios.map((id, i) => (
            <span key={id}>
              {i > 0 ? " · " : ""}
              <strong style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{id}</strong> {scenarioLabel(id).toLowerCase()}
            </span>
          ))}
        </span>
      </Row>

      {record.lines.length ? (
        <Row title={`Lines · total ${formatMoney(record.request_total, currency)}`}>
          <div style={{ display: "flex", flexDirection: "column", border: "var(--border-w) solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
            {record.lines.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "4px 12px",
                  padding: "var(--space-2) var(--space-3)",
                  borderTop: i > 0 ? "var(--border-w) solid var(--border-subtle)" : undefined,
                }}
              >
                <span style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{l.matched_sku ?? "no match"}</span>
                  <span style={{ ...caption, overflowWrap: "anywhere" }}>“{l.requested_text}”</span>
                </span>
                <span style={{ ...caption, ...num }}>
                  {l.quantity ?? "?"} × {l.unit_price != null ? formatMoney(l.unit_price, currency) : "?"}
                  {l.stock_on_hand != null ? ` · ${l.stock_on_hand} on hand` : ""}
                </span>
                <Badge tone={LINE_TONE[l.line_status]}>
                  {l.scenario} · {l.line_status}
                </Badge>
              </div>
            ))}
          </div>
        </Row>
      ) : null}

      {record.checkout_url ? (
        <span style={caption}>
          Checkout link:{" "}
          <a href={record.checkout_url} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
            {record.checkout_url}
          </a>
        </span>
      ) : null}
    </div>
  );
}
