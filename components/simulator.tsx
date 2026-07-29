"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Banner } from "@/components/ui/states";
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
      issues: string[];
      line: { rawText: string; quantity: number | null };
    }>;
    result?: { orderId?: number; quoteId?: number; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string };
    audit?: Array<{ at: string; event: string; detail?: unknown }>;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Left-rule + chip colours for the decision card, per the design's decision palette. */
const DECISION_STYLE: Record<string, { rule: string; chip: string }> = {
  order: { rule: "var(--ok-dot)", chip: "ok" },
  quote: { rule: "var(--accent)", chip: "quote" },
  clarify: { rule: "var(--warn-dot)", chip: "warn" },
  escalate: { rule: "var(--bad-dot)", chip: "bad" },
  reject: { rule: "var(--bad-dot)", chip: "bad" },
};

const STEP_TONE: Record<string, string> = {
  received: "sage",
  identified: "sage",
  extracted: "sage",
  resolved: "sage",
  triaged: "sage",
  decided: "sky",
  reopened: "sage",
  error: "bad",
  escalated: "bad",
};

function stepTone(event: string, detail?: unknown): string {
  if (STEP_TONE[event]) return STEP_TONE[event];
  return typeof detail === "string" && detail.includes("error") ? "bad" : "sage";
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

const SKELETON_WIDTHS = ["62%", "100%", "84%", "73%", "91%"];

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
  const style = DECISION_STYLE[decisionKind] ?? { rule: "var(--accent)", chip: "sky" };
  const currency = s?.extracted?.currency;

  return (
    <div className="pa-2col">
      {/* ── Left: the PO ── */}
      <div className="card pad">
        {sandbox && (
          <div className="pa-callout warn mb-3">
            <div className="t">Sandbox — real submissions ON</div>
            <div className="b">
              {sandboxEmails
                ? "Orders/quotes go to the connected store and buyer emails will send."
                : "Orders/quotes go to the connected store; buyer emails are suppressed and captured below."}
            </div>
          </div>
        )}

        <div className="field">
          <span className="label">Scenario</span>
          <div className="pa-wrap">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.label}
                type="button"
                className={`chip-btn round${scenario === sc.label ? " on" : ""}`}
                onClick={() => handleScenarioChange(sc.label)}
              >
                {sc.label}
              </button>
            ))}
            {scenario === CUSTOM_LABEL && <span className="chip neutral">Custom</span>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="sim-from">Sender email</label>
          <input
            id="sim-from"
            type="text"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              handleFormEdit();
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="sim-subject">Subject</label>
          <input
            id="sim-subject"
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              handleFormEdit();
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="sim-body">PO body</label>
          <textarea
            id="sim-body"
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value);
              handleFormEdit();
            }}
            style={{ height: 160 }}
          />
        </div>

        <div className="pa-wrap mt-3">
          <button type="button" className="btn primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run pipeline"}
          </button>
          <span className="faint" style={{ fontSize: 11.5 }}>
            Try &ldquo;pay by credit card&rdquo; for a quote, or an unknown sender for a reject.
          </span>
        </div>

        {error && <p className="mt-2 mb-0" style={{ color: "var(--bad-fg)" }}>{error}</p>}

        <p className="muted mt-2 mb-0" style={{ fontSize: 12 }}>
          {sandbox
            ? "Sandbox mode — submits a REAL order/quote to the connected store (tagged “[PO agent sandbox]”)."
            : "Dry run — never submits an order/quote and never sends email."}
        </p>
      </div>

      {/* ── Right: the decision ── */}
      <div>
        {!result && !loading && (
          <div className="pa-placeholder">
            <div className="t">Run a PO to see the decision</div>
            <div className="b">identify → extract → resolve → price → validate → decide</div>
          </div>
        )}

        {loading && (
          <div className="card">
            <div className="card-body" style={{ padding: "20px 18px" }}>
              {SKELETON_WIDTHS.map((w) => (
                <div key={w} className="skeleton" style={{ width: w }} />
              ))}
            </div>
          </div>
        )}

        {!loading && result && !result.storeConfigured && (
          <div className="card">
            <div className="card-head">Store not configured</div>
            <div className="card-body">
              <p className="muted" style={{ marginTop: 0 }}>{result.note}</p>
              <Banner kind="info">
                Connect a BigCommerce store in <a href="/staff/settings">Settings</a> to run the full pipeline.
              </Banner>
              {result.extracted ? <pre className="block mt-3">{JSON.stringify(result.extracted, null, 2)}</pre> : null}
            </div>
          </div>
        )}

        {!loading && s && (
          <div className="stack">
            {result?.sandboxBlocked && (
              <Banner kind="warn" title="Ran as a dry run">
                Sandbox mode is on but Redis or a store token is missing. No order/quote was placed.
              </Banner>
            )}

            <div className="card" style={{ borderLeft: `4px solid ${style.rule}` }}>
              <div className="card-body">
                <div className="pa-wrap">
                  <span className={`chip ${style.chip} lg`}>{decisionKind || "—"}</span>
                  <span style={{ fontSize: 12.5, color: "var(--body2)" }}>
                    {s.decision?.reasons.join(" · ") || outcome?.headline}
                  </span>
                </div>
                <div className="muted mt-2" style={{ fontSize: 12 }}>
                  {s.buyer?.companyName ?? "unidentified sender"}
                  {s.buyer?.email ? ` · ${s.buyer.email}` : ""}
                </div>
                {outcome && outcome.reasons.length > 0 && (
                  <ul className="mt-2" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                    {outcome.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {result?.sandbox && s.result && (s.result.orderId || s.result.quoteId) && (
              <div className="card">
                <div className="card-head sm">
                  <span>Submitted {result.emailsSent ? "· emails sent" : "· emails captured"}</span>
                </div>
                <div className="card-body sm">
                  {s.result.orderId && (
                    <p style={{ marginTop: 0 }}>
                      Order <strong className="num">#{s.result.orderId}</strong> placed in the store.
                    </p>
                  )}
                  {s.result.quoteId && (
                    <p style={{ marginTop: 0 }}>
                      Quote <strong className="num">{s.result.quoteNumber ?? s.result.quoteId}</strong> created.
                      {s.result.checkoutUrl && (
                        <>
                          {" "}
                          <a href={s.result.checkoutUrl} target="_blank" rel="noreferrer">Checkout link →</a>{" "}
                          <button type="button" className="btn xs" onClick={() => copyText(s.result!.checkoutUrl!)}>
                            Copy
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  <p className="faint mb-0" style={{ fontSize: 12 }}>
                    Tagged &ldquo;[PO agent sandbox]&rdquo; — safe to delete in the store.
                  </p>
                </div>
              </div>
            )}

            {result?.sandbox && !result.emailsSent && result.captured && result.captured.length > 0 && (
              <div className="card">
                <div className="card-head sm">
                  <span>Captured emails</span>
                  <span className="chip count neutral num">{result.captured.length}</span>
                </div>
                <div className="card-body sm">
                  <div className="stack">
                    {result.captured.map((c, i) => (
                      <div key={i}>
                        <div className="row-between">
                          <span className="muted" style={{ fontSize: 12 }}>
                            {c.to ? `to ${c.to} · ` : ""}
                            {c.subject}
                          </span>
                          <button type="button" className="btn xs" onClick={() => copyText(c.text ?? "")}>
                            Copy
                          </button>
                        </div>
                        <pre className="block mt-1">{c.text}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {s.resolution && s.resolution.length > 0 && (
              <div className="card">
                <div className="card-head sm">
                  <span>Lines</span>
                </div>
                {s.resolution.map((r, i) => {
                  const bad = r.issues.some((x) => x === "line_unresolved" || x === "price_mismatch");
                  const warn = !bad && r.issues.length > 0;
                  return (
                    <div key={i} className={`pa-row${bad ? " tint-bad" : warn ? " tint-warn" : ""}`}>
                      <div className="pa-grow">
                        <div className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--head)" }}>
                          {r.matchedSku ?? "— no match —"}
                        </div>
                        <div className="r-sub num">read from: “{r.line.rawText.trim()}”</div>
                      </div>
                      <span className="num" style={{ fontSize: 12.5, color: "var(--body2)", flex: "none" }}>
                        {r.line.quantity ?? "?"} ×{" "}
                        {r.calculatedUnitPrice != null ? formatMoney(r.calculatedUnitPrice, currency) : "?"}
                      </span>
                      <span
                        className="num"
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          flex: "none",
                          color: bad ? "var(--bad-fg)" : warn ? "var(--warn-fg)" : "var(--ok-fg)",
                        }}
                      >
                        {r.issues.join(", ") || "ok"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {s.validation && s.validation.length > 0 && (
              <div className="card">
                <div className="card-head sm">
                  <span>Issues</span>
                </div>
                <div className="card-body sm">
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                    {s.validation.map((v, i) => (
                      <li key={i}>
                        <code>{v.kind}</code>
                        {v.lineRef ? ` (${v.lineRef})` : ""} — {v.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {s.audit && s.audit.length > 0 && (
              <div className="card">
                <div className="card-head sm">
                  <span>Pipeline</span>
                </div>
                <div className="card-body sm">
                  <div className="timeline tight">
                    {s.audit.map((a, i) => (
                      <div className="ev" key={i}>
                        <span className={`dot-status ${stepTone(a.event, a.detail)}`} />
                        <div className="txt">
                          <strong>{a.event}</strong> <span>{stepDetail(a.detail)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
