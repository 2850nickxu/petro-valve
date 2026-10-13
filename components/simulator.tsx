"use client";

import { useState, type CSSProperties } from "react";
import { Badge, Button, Panel, Spinner, TextField, TextareaField } from "@/components/backbone";
import { useToast } from "@/components/ui/toast";
import { Banner, EmptyState } from "@/components/ui/states";
import { Timeline, type StatusTone } from "@/components/ui/detail-widgets";
import { badgeVariant } from "@/lib/ui/badge-variant";
import { summarizeOutcome } from "@/lib/po-agent/summary";
import { formatMoney } from "@/components/ui/money";
import { reSubject } from "@/lib/po-agent/messages";
import type { DecisionKind, SessionMessage, StepOutcome, ValidationIssueKind } from "@/lib/po-agent/types";
import { OUTCOME } from "@/lib/po-agent/session-view";
import { customerEmail } from "@/lib/po-agent/people";
import { lineSeverity } from "@/lib/ui/line-severity";

// ── Scenario library ──────────────────────────────────────────────────────────

interface Scenario {
  label: string;
  from: string;
  subject: string;
  body: string;
}

const SCENARIOS: Scenario[] = [
  {
    label: "Order on account",
    from: "t.nguyen@pacific-elec.com",
    subject: "New purchase order",
    body: `PO Number: PO-5567
Please pay on account, net 30.

SKU: COR-MCT-15ML Qty: 1
SKU: EPP-TIP-200F Qty: 5`,
  },
  {
    label: "Card payment → quote",
    from: "a.mitchell@westernpower.com",
    subject: "New purchase order",
    body: `PO Number: PO-1624
Please pay using card

SKU: ANS-GLV-NIT-XL   Qty: 5
SKU: SKF-BRG-6205-2RS     Qty: 15`,
  },
  {
    // The description names a different product than the SKU matches — held for review.
    label: "SKU and description disagree",
    from: "t.nguyen@pacific-elec.com",
    subject: "New purchase order",
    body: `PO Number: PO-5574
Please pay on account, net 30.

Sloan Check Valves 1" Sweat
SKU: ANS-GLV-NIT-XL   Qty: 5`,
  },
  {
    label: "Wrong SKU",
    from: "t.nguyen@pacific-elec.com",
    subject: "New purchase order",
    body: `PO Number: PO-5570
Please pay on account, net 30.

SKU: WRONG-SKU   Qty: 10`,
  },
  {
    label: "Low inventory, wrong price",
    from: "t.nguyen@pacific-elec.com",
    subject: "New purchase order",
    body: `PO Number: PO-5572
Please pay on account, net 60.

SKU: SW-12-2-NM-250   Qty: 1000   $1`,
  },
  {
    label: "Unknown sender",
    from: "unknown@unknowncompany.com",
    subject: "New purchase order",
    body: `PO Number: PO-1625
Please pay using card on file

SKU: MECHAN-SAFETY-00064   Qty: 50   $149.44`,
  },
];

const CUSTOM_LABEL = "Custom";

// ── Types ─────────────────────────────────────────────────────────────────────

type SimResult = {
  storeConfigured: boolean;
  modelConfigured?: boolean;
  note?: string;
  extracted?: unknown;
  sandbox?: boolean;
  sandboxBlocked?: boolean;
  emailsSent?: boolean;
  captured?: Array<{ to?: string; subject?: string; text?: string }>;
  session?: {
    threadId?: string;
    messages?: Array<Pick<SessionMessage, "direction">>;
    state: string;
    decision?: { kind: DecisionKind; reasons: string[] };
    escalation?: { reasons: string[] };
    buyer?: { companyName?: string; email?: string };
    inbound?: { from?: string };
    extracted?: { currency?: string | null };
    validation?: Array<{ kind: ValidationIssueKind; message: string; lineRef?: string; blocking: boolean }>;
    resolution?: Array<{
      matchedSku?: string;
      productId?: number;
      calculatedUnitPrice?: number;
      parentSku?: boolean;
      variantChoices?: Array<{ variantId: number; sku: string; optionLabel?: string; unitPrice?: number }>;
      variantChoiceCount?: number;
      issues: string[];
      line: { rawText: string; quantity: number | null };
    }>;
    result?: { orderId?: number; quoteId?: number; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string };
    audit?: Array<{ at: string; event: string; detail?: unknown; summary?: string; outcome?: StepOutcome }>;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Audit-event dot colour, in the app's StatusTone vocabulary. */
const STEP_TONE: Record<string, StatusTone> = {
  received: "ok",
  identified: "ok",
  extracted: "ok",
  resolved: "ok",
  triaged: "ok",
  decided: "sky",
  reopened: "ok",
  error: "bad",
  escalated: "bad",
};

/** A step's recorded outcome wins (a flagged Validate is amber, not green); older steps
 * without one fall back to the event name. */
function stepTone(event: string, detail?: unknown, outcome?: StepOutcome): StatusTone {
  const t = outcome ? OUTCOME[outcome].tone : undefined;
  if (t === "danger") return "bad";
  if (t === "warning") return "warn";
  if (STEP_TONE[event]) return STEP_TONE[event];
  return typeof detail === "string" && detail.includes("error") ? "bad" : "ok";
}

/** Compact, readable rendering of an audit detail blob. */
function stepDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "object") {
    return Object.entries(detail as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  }
  return String(detail);
}

// Backbone has no pre-formatted output primitive; this is a token-driven dark code block.
const CODE_BLOCK: CSSProperties = {
  margin: 0,
  padding: 13,
  borderRadius: "var(--radius-md)",
  background: "var(--surface-inverse)",
  color: "var(--text-inverse)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflow: "auto",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function Simulator({
  defaultFrom = SCENARIOS[0].from,
  sandbox = false,
  sandboxEmails = false,
}: {
  defaultFrom?: string;
  sandbox?: boolean;
  sandboxEmails?: boolean;
}) {
  const toast = useToast();

  const [scenario, setScenario] = useState<string>(CUSTOM_LABEL);
  const [from, setFrom] = useState(defaultFrom);
  const [subject, setSubject] = useState(SCENARIOS[0].subject);
  const [bodyText, setBodyText] = useState(SCENARIOS[0].body);
  // Set ⇒ the next run is a buyer reply on this sandbox thread (joins its session).
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleScenarioChange(label: string) {
    setScenario(label);
    if (label === CUSTOM_LABEL) return; // leave the form as-is
    const s = SCENARIOS.find((sc) => sc.label === label);
    if (!s) return;
    setReplyThreadId(null); // a scenario is a fresh PO, not a reply
    setFrom(s.from);
    setSubject(s.subject);
    setBodyText(s.body);
  }

  function handleFormEdit() {
    setScenario(CUSTOM_LABEL);
  }

  function replyOnThread(threadId: string) {
    setReplyThreadId(threadId);
    setScenario(CUSTOM_LABEL);
    setSubject(reSubject(subject));
    setBodyText("");
  }

  async function run() {
    setLoading(true);
    setError(null);
    // Keep the previous result and inputs on error so nothing is lost.
    try {
      const res = await fetch("/api/po-agent/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, subject, bodyText, ...(replyThreadId ? { threadId: replyThreadId } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error ?? "Request failed";
        setError(msg);
        toast.error(msg);
      } else {
        setResult(json);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied."),
      () => toast.error("Copy failed — please select and copy manually."),
    );
  }

  const s = result?.session;
  const outcome = s ? summarizeOutcome(s) : null;
  const decisionKind = s?.decision?.kind ?? "";
  const decisionTone = decisionKind ? badgeVariant(decisionKind) : "info";
  const currency = s?.extracted?.currency;
  const messagesIn = s?.messages?.filter((m) => m.direction === "in").length ?? 0;
  const messagesOut = (s?.messages?.length ?? 0) - messagesIn;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--gap-group)", alignItems: "start" }}>
      {/* ── Left: the PO ── */}
      <Panel title="Purchase order" bodyStyle={{ gap: "var(--gap-group)" }}>
        {sandbox && (
          <Banner kind="warn" title="Sandbox — real submissions on">
            {sandboxEmails
              ? "Orders/quotes go to the connected store and buyer emails will send."
              : "Orders/quotes go to the connected store; buyer emails are suppressed and captured below."}
          </Banner>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ fontSize: "var(--text-label-size)", fontWeight: "var(--text-label-weight)", letterSpacing: "var(--text-label-tracking)", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Scenario
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {SCENARIOS.map((sc) => (
              <Button
                key={sc.label}
                variant={scenario === sc.label ? "primary" : "secondary"}
                size="micro"
                onClick={() => handleScenarioChange(sc.label)}
              >
                {sc.label}
              </Button>
            ))}
            {scenario === CUSTOM_LABEL && <Badge tone="neutral">Custom</Badge>}
          </div>
        </div>

        <TextField
          label="Sender email"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            handleFormEdit();
          }}
        />
        <TextField
          label="Subject"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            handleFormEdit();
          }}
        />
        <TextareaField
          label="PO body"
          value={bodyText}
          onChange={(e) => {
            setBodyText(e.target.value);
            handleFormEdit();
          }}
          rows={7}
        />

        {replyThreadId && (
          <Banner kind="info" title="Replying as the buyer">
            <span>
              This run is sent on thread <span style={{ fontFamily: "var(--font-mono)" }}>{replyThreadId}</span> and joins that session.{" "}
              <Button variant="ghost" size="micro" onClick={() => setReplyThreadId(null)}>Start a new thread</Button>
            </span>
          </Banner>
        )}

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Button variant="primary" onClick={run} loading={loading} icon="arrow-right">
            {loading ? "Running…" : "Run pipeline"}
          </Button>
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
            Pick a scenario, or edit any field to try your own PO.
          </span>
        </div>

        {error && <span style={{ color: "var(--danger-600)" }}>{error}</span>}

        <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
          {sandbox
            ? "Sandbox mode — submits a REAL order/quote to the connected store (tagged “[PO agent sandbox]”)."
            : "Dry run — never submits an order/quote and never sends email."}
        </span>
      </Panel>

      {/* ── Right: the decision ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-group)" }}>
        {!result && !loading && (
          <Panel>
            <EmptyState title="Run a PO to see the decision">
              identify → extract → resolve → price → validate → decide
            </EmptyState>
          </Panel>
        )}

        {loading && (
          <Panel>
            <Spinner label="Running the pipeline…" />
          </Panel>
        )}

        {!loading && result && !result.storeConfigured && (
          <Panel title="Store not configured" bodyStyle={{ gap: "var(--gap-group)" }}>
            <span style={{ color: "var(--text-secondary)" }}>{result.note}</span>
            <Banner kind="info">
              Connect a BigCommerce store in <a href="/staff/settings">Settings</a> to run the full pipeline.
            </Banner>
            {result.extracted ? <pre style={CODE_BLOCK}>{JSON.stringify(result.extracted, null, 2)}</pre> : null}
          </Panel>
        )}

        {!loading && s && (
          <>
            {result?.sandboxBlocked && (
              <Banner kind="warn" title="Ran as a dry run">
                Sandbox mode is on but Redis or a store token is missing. No order/quote was placed.
              </Banner>
            )}

            <Panel title="Decision" actions={<Badge tone={decisionTone}>{decisionKind || "—"}</Badge>} bodyStyle={{ gap: "var(--space-2)" }}>
              <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-secondary)" }}>
                {s.decision?.reasons.join(" · ") || outcome?.headline}
              </span>
              <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
                {customerEmail(s)}
                {` · ${s.buyer?.companyName ?? "No matching account"}`}
              </span>
              {outcome && outcome.reasons.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-caption-size)" }}>
                  {outcome.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {result?.sandbox && s.threadId && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
                    Messages on this session: {messagesIn} in · {messagesOut} out
                  </span>
                  <Button variant="secondary" size="micro" onClick={() => replyOnThread(s.threadId!)}>
                    Reply as the buyer on this thread
                  </Button>
                </div>
              )}
            </Panel>

            {result?.sandbox && s.result && (s.result.orderId || s.result.quoteId) && (
              <Panel title="Submitted" actions={<Badge tone="neutral">{result.emailsSent ? "emails sent" : "emails captured"}</Badge>} bodyStyle={{ gap: "var(--space-2)" }}>
                {s.result.orderId && (
                  <span>
                    Order <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>#{s.result.orderId}</span> placed in the store.
                  </span>
                )}
                {s.result.quoteId && (
                  <span>
                    Quote <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{s.result.quoteNumber ?? s.result.quoteId}</span> created.
                    {s.result.checkoutUrl && (
                      <>
                        {" "}
                        <a href={s.result.checkoutUrl} target="_blank" rel="noreferrer">Checkout link →</a>{" "}
                        <Button variant="ghost" size="micro" icon="copy" onClick={() => copyText(s.result!.checkoutUrl!)}>Copy</Button>
                      </>
                    )}
                  </span>
                )}
                <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
                  Tagged &ldquo;[PO agent sandbox]&rdquo; — safe to delete in the store.
                </span>
              </Panel>
            )}

            {result?.sandbox && !result.emailsSent && result.captured && result.captured.length > 0 && (
              <Panel title="Captured emails" actions={<Badge tone="neutral" mono>{result.captured.length}</Badge>} bodyStyle={{ gap: 12 }}>
                {result.captured.map((c, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
                        {c.to ? `to ${c.to} · ` : ""}
                        {c.subject}
                      </span>
                      <Button variant="ghost" size="micro" icon="copy" onClick={() => copyText(c.text ?? "")}>Copy</Button>
                    </div>
                    <pre style={CODE_BLOCK}>{c.text}</pre>
                  </div>
                ))}
              </Panel>
            )}

            {s.resolution && s.resolution.length > 0 && (
              <Panel title="Lines" padded={false}>
                {s.resolution.map((r, i) => {
                  const sev = lineSeverity(r.issues);
                  const bad = sev === "bad";
                  const warn = sev === "warn";
                  const rowBg = bad ? "var(--danger-tint)" : warn ? "var(--warning-tint)" : undefined;
                  const issueColor = bad ? "var(--danger-600)" : warn ? "var(--warning-600)" : "var(--success-600)";
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 10,
                        padding: "var(--space-2-5) var(--panel-pad)",
                        background: rowBg,
                        borderTop: i > 0 ? "var(--border-w) solid var(--border-subtle)" : undefined,
                      }}
                    >
                      <span style={{ flex: "1 1 230px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>{r.matchedSku ?? "— no match —"}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-metadata)" }}>read from: “{r.line.rawText.trim()}”</span>
                        {r.parentSku && r.variantChoices?.length ? (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-metadata)" }}>
                            parent SKU — choose one:{" "}
                            {r.variantChoices
                              .slice(0, 4)
                              .map((c) => (c.unitPrice != null ? `${c.sku} @ ${formatMoney(c.unitPrice, currency)}` : c.sku))
                              .join(", ")}
                            {(r.variantChoiceCount ?? r.variantChoices.length) > 4
                              ? ` +${(r.variantChoiceCount ?? r.variantChoices.length) - 4} more`
                              : ""}
                          </span>
                        ) : null}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-metadata)", flex: "none" }}>
                        {r.line.quantity ?? "?"} × {r.calculatedUnitPrice != null ? formatMoney(r.calculatedUnitPrice, currency) : "?"}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 700, color: issueColor, flex: "none" }}>
                        {r.issues.join(", ") || "ok"}
                      </span>
                    </div>
                  );
                })}
              </Panel>
            )}

            {s.validation && s.validation.length > 0 && (
              <Panel title="Issues">
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-caption-size)" }}>
                  {s.validation.map((v, i) => (
                    <li key={i}>
                      <code>{v.kind}</code>
                      {v.lineRef ? ` (${v.lineRef})` : ""} — {v.message}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {s.audit && s.audit.length > 0 && (
              <Panel title="Pipeline">
                <Timeline
                  items={s.audit.map((a, i) => ({
                    key: i,
                    tone: stepTone(a.event, a.detail, a.outcome),
                    title: a.event,
                    detail: a.summary ?? stepDetail(a.detail),
                  }))}
                />
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
