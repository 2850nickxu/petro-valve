"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Banner } from "@/components/ui/states";
import { summarizeOutcome } from "@/lib/po-agent/summary";
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
    label: "Credit-card → quote",
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
    validation?: Array<{ kind: ValidationIssueKind; message: string; lineRef?: string; blocking: boolean }>;
    resolution?: Array<{ matchedSku?: string; productId?: number; calculatedUnitPrice?: number; issues: string[]; line: { rawText: string; quantity: number | null } }>;
    result?: { orderId?: number; quoteId?: number; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string };
    audit?: Array<{ at: string; event: string; detail?: unknown }>;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type BannerKind = "ok" | "warn" | "error" | "info";

function decisionBannerKind(kind: string): BannerKind {
  if (kind === "order" || kind === "quote") return "ok";
  if (kind === "escalate" || kind === "clarify") return "warn";
  if (kind === "reject") return "error";
  return "info";
}

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

  // If a custom defaultFrom is supplied (e.g. from the staff simulator), start in Custom
  // mode so the scenario dropdown doesn't misrepresent the active preset.
  const initialScenario = defaultFrom === SCENARIOS[0].from ? SCENARIOS[0].label : CUSTOM_LABEL;
  const [scenario, setScenario] = useState<string>(initialScenario);
  const [from, setFrom] = useState(defaultFrom);
  const [subject, setSubject] = useState(SCENARIOS[0].subject);
  const [bodyText, setBodyText] = useState(SCENARIOS[0].body);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Scenario selection ────────────────────────────────────────────────────

  function handleScenarioChange(label: string) {
    setScenario(label);
    if (label === CUSTOM_LABEL) return; // leave form as-is
    const s = SCENARIOS.find((sc) => sc.label === label);
    if (!s) return;
    setFrom(s.from);
    setSubject(s.subject);
    setBodyText(s.body);
  }

  function handleFormEdit() {
    // If the user edits the form manually, switch to Custom
    setScenario(CUSTOM_LABEL);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function run() {
    setLoading(true);
    setError(null);
    // Do NOT clear result or form inputs here — preserve them on error
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

  // ── Copy helper ───────────────────────────────────────────────────────────

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied."),
      () => toast.error("Copy failed — please select and copy manually."),
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const s = result?.session;
  const outcome = s ? summarizeOutcome(s) : null;

  return (
    <div className="grid cols-2">
      {/* ── Left column: form ── */}
      <div className="card">
        <h3>Purchase order</h3>

        {sandbox && (
          <p className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn)", display: "inline-block", marginBottom: 12 }}>
            SANDBOX — real submissions ON{sandboxEmails ? " · emails will send" : " · emails suppressed"}
          </p>
        )}

        <div className="field">
          <label>Load a scenario</label>
          <select
            value={scenario}
            onChange={(e) => handleScenarioChange(e.target.value)}
          >
            {SCENARIOS.map((sc) => (
              <option key={sc.label} value={sc.label}>{sc.label}</option>
            ))}
            <option value={CUSTOM_LABEL}>{CUSTOM_LABEL}</option>
          </select>
        </div>

        <div className="field">
          <label>Sender email</label>
          <input
            value={from}
            onChange={(e) => { setFrom(e.target.value); handleFormEdit(); }}
          />
        </div>
        <div className="field">
          <label>Subject</label>
          <input
            value={subject}
            onChange={(e) => { setSubject(e.target.value); handleFormEdit(); }}
          />
        </div>
        <div className="field">
          <label>Body</label>
          <textarea
            rows={10}
            value={bodyText}
            onChange={(e) => { setBodyText(e.target.value); handleFormEdit(); }}
          />
        </div>

        <button className="btn primary" onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run pipeline"}
        </button>

        {error && (
          <p className="mt-1" style={{ color: "var(--bad)" }}>{error}</p>
        )}

        <p className="muted mt-1">
          {sandbox
            ? "Sandbox mode — submits a REAL order/quote to the connected store (tagged “[PO agent sandbox]”)."
            : "Dry run — never submits an order/quote and never sends email."}
        </p>
      </div>

      {/* ── Right column: result ── */}
      <div className="stack">
        {!result && !loading && (
          <div className="card muted">Run a PO to see the pipeline result.</div>
        )}

        {result && !result.storeConfigured && (
          <div className="card">
            <h3>Store not configured</h3>
            <p className="muted">{result.note}</p>
            <Banner kind="info">
              Connect a BigCommerce store in{" "}
              <a href="/staff/settings">Settings</a> to run the full pipeline.
            </Banner>
            {result.extracted ? (
              <pre className="block mt-1">{JSON.stringify(result.extracted, null, 2)}</pre>
            ) : null}
          </div>
        )}

        {s && (
          <>
            {result?.sandboxBlocked && (
              <div className="card" style={{ borderColor: "var(--warn)" }}>
                <p className="muted" style={{ margin: 0 }}>
                  Sandbox mode is on but this ran as a dry run (Redis or a store token is missing). No order/quote was placed.
                </p>
              </div>
            )}

            {/* Decision card with plain-language summary */}
            <div className="card">
              <h3>Decision</h3>
              {outcome && (
                <>
                  <Banner kind={decisionBannerKind(outcome.kind)}>
                    <strong>{outcome.headline}</strong>
                  </Banner>
                  {outcome.reasons.length > 0 && (
                    <ul className="mt-1" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      {outcome.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </>
              )}
              <p className="mt-1" style={{ fontSize: 16 }}>
                <span className={`badge ${s.decision?.kind}`}>{s.decision?.kind}</span>{" "}
              </p>
              <p className="muted">{s.buyer?.companyName ?? "—"} · {s.buyer?.email ?? "unknown"}</p>
            </div>

            {/* Sandbox submission result */}
            {result?.sandbox && s.result && (s.result.orderId || s.result.quoteId) && (
              <div className="card">
                <h3>Submitted {result.emailsSent ? "· emails sent" : "· emails captured"}</h3>
                {s.result.orderId && (
                  <p>Order <strong className="mono">#{s.result.orderId}</strong> placed in the store.</p>
                )}
                {s.result.quoteId && (
                  <p>
                    Quote{" "}
                    <strong className="mono">{s.result.quoteNumber ?? s.result.quoteId}</strong>{" "}
                    created.
                    {s.result.checkoutUrl && (
                      <>
                        {" "}
                        <a href={s.result.checkoutUrl} target="_blank" rel="noreferrer">Checkout link →</a>
                        {" "}
                        <button
                          className="btn sm"
                          style={{ marginLeft: 4 }}
                          onClick={() => copyText(s.result!.checkoutUrl!)}
                        >
                          Copy
                        </button>
                      </>
                    )}
                  </p>
                )}
                <p className="muted" style={{ fontSize: 12 }}>Tagged "[PO agent sandbox]" — safe to delete in the store.</p>
              </div>
            )}

            {/* Captured emails (sandbox) */}
            {result?.sandbox && !result.emailsSent && result.captured && result.captured.length > 0 && (
              <div className="card">
                <h3>Captured emails ({result.captured.length})</h3>
                <div className="stack">
                  {result.captured.map((c, i) => (
                    <div key={i}>
                      <div className="row-between">
                        <span className="muted" style={{ fontSize: 12 }}>
                          {c.to ? `to ${c.to} · ` : ""}{c.subject}
                        </span>
                        <button
                          className="btn sm"
                          onClick={() => copyText(c.text ?? "")}
                        >
                          Copy
                        </button>
                      </div>
                      <pre className="block mt-1">{c.text}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lines table */}
            <div className="card">
              <h3>Lines</h3>
              <table className="table">
                <thead>
                  <tr><th>SKU</th><th>Qty</th><th>Unit</th><th>Issues</th></tr>
                </thead>
                <tbody>
                  {s.resolution?.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.matchedSku ?? r.line.rawText.slice(0, 24)}</td>
                      <td>{r.line.quantity ?? "—"}</td>
                      <td>{r.calculatedUnitPrice != null ? `$${r.calculatedUnitPrice.toFixed(2)}` : "—"}</td>
                      <td className="muted">{r.issues.join(", ") || "ok"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Validation issues */}
            {s.validation && s.validation.length > 0 && (
              <div className="card">
                <h3>Issues</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {s.validation.map((v, i) => (
                    <li key={i}><code>{v.kind}</code> {v.lineRef ? `(${v.lineRef})` : ""} — {v.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pipeline steps */}
            <div className="card">
              <h3>Pipeline steps</h3>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {s.audit?.map((a, i) => (
                  <li key={i}>
                    <strong>{a.event}</strong>{" "}
                    {a.detail ? <code>{JSON.stringify(a.detail)}</code> : null}
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
