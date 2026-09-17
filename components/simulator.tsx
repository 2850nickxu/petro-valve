"use client";

import { useState, type CSSProperties } from "react";
import { Badge, Button, Panel, Spinner, TextField, TextareaField } from "@/components/backbone";
import { useToast } from "@/components/ui/toast";
import { Banner, EmptyState } from "@/components/ui/states";
import { Timeline, type StatusTone } from "@/components/ui/detail-widgets";
import { badgeVariant } from "@/lib/ui/badge-variant";
import { summarizeOutcome } from "@/lib/po-agent/summary";
import { formatMoney } from "@/components/ui/money";
import type { DecisionKind, ValidationIssueKind } from "@/lib/po-agent/types";

// ── Scenario library ──────────────────────────────────────────────────────────

interface Scenario {
  label: string;
  from: string;
  subject: string;
  body: string;
}

const SCENARIOS: Scenario[] = [
  {
    label: "Clean terms order",
    from: "buyer@acme.com",
    subject: "New purchase order",
    body: `PO Number: PO-5567
Please pay on account, net 30.

SKU: WIDGET-100   Qty: 10   $9.84
SKU: BOLT-250     Qty: 40`,
  },
  {
    label: "Credit card → quote",
    from: "buyer@acme.com",
    subject: "Purchase order — card payment",
    body: `PO Number: PO-5568
Please charge our credit card on file.

SKU: WIDGET-100   Qty: 10   $9.84
SKU: BOLT-250     Qty: 40`,
  },
  {
    label: "Unknown sender → reject",
    from: "stranger@example.com",
    subject: "Purchase order",
    body: `PO Number: PO-9001
Please pay on account, net 30.

SKU: WIDGET-100   Qty: 5   $9.84`,
  },
  {
    label: "Broken SKU → clarify",
    from: "buyer@acme.com",
    subject: "Purchase order with new items",
    body: `PO Number: PO-5569
Please pay on account, net 30.

SKU: DOES-NOT-EXIST-999   Qty: 5   $19.99`,
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
    state: string;
    decision?: { kind: DecisionKind; reasons: string[] };
    escalation?: { reasons: string[] };
    buyer?: { companyName?: string; email?: string };
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
    audit?: Array<{ at: string; event: string; detail?: unknown }>;
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

function stepTone(event: string, detail?: unknown): StatusTone {
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
  defaultFrom = "buyer@acme.com",
  sandbox = false,
  sandboxEmails = false,
}: {
  defaultFrom?: string;
  sandbox?: boolean;
  sandboxEmails?: boolean;
}) {
  const toast = useToast();

  const initialScenario = defaultFrom === SCENARIOS[0].from ? SCENARIOS[0].label : CUSTOM_LABEL;
  const [scenario, setScenario] = useState<string>(initialScenario);
  const [from, setFrom] = useState(defaultFrom);
  const [subject, setSubject] = useState(SCENARIOS[0].subject);
  const [bodyText, setBodyText] = useState(SCENARIOS[0].body);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleScenarioChange(label: string) {
    setScenario(label);
    if (label === CUSTOM_LABEL) return; // leave the form as-is
    const s = SCENARIOS.find((sc) => sc.label === label);
    if (!s) return;
    setFrom(s.from);
    setSubject(s.subject);
    setBodyText(s.body);
  }

  function handleFormEdit() {
    setScenario(CUSTOM_LABEL);
  }

  async function run() {
    setLoading(true);
    setError(null);
    // Keep the previous result and inputs on error so nothing is lost.
    try {
      const res = await fetch("/api/po-agent/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, subject, bodyText }),
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

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Button variant="primary" onClick={run} loading={loading} icon="arrow-right">
            {loading ? "Running…" : "Run pipeline"}
          </Button>
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
            Try &ldquo;pay by credit card&rdquo; for a quote, or an unknown sender for a reject.
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
                {s.buyer?.companyName ?? "unidentified sender"}
                {s.buyer?.email ? ` · ${s.buyer.email}` : ""}
              </span>
              {outcome && outcome.reasons.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-caption-size)" }}>
                  {outcome.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
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
                  const bad = r.issues.some((x) => x === "line_unresolved" || x === "line_parent_sku" || x === "price_mismatch");
                  const warn = !bad && r.issues.length > 0;
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
                    tone: stepTone(a.event, a.detail),
                    title: a.event,
                    detail: stepDetail(a.detail),
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
