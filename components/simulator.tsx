"use client";

import { useState } from "react";

const SAMPLE = `PO Number: PO-5567
Please pay on account, net 30.

SKU: WIDGET-100   Qty: 10   $9.84
SKU: BOLT-250     Qty: 40`;

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
    decision?: { kind: string; reasons: string[] };
    buyer?: { companyName?: string; email?: string };
    validation?: Array<{ kind: string; message: string; lineRef?: string }>;
    resolution?: Array<{ matchedSku?: string; productId?: number; calculatedUnitPrice?: number; issues: string[]; line: { rawText: string; quantity: number | null } }>;
    result?: { orderId?: number; quoteId?: number; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string };
    audit?: Array<{ at: string; event: string; detail?: unknown }>;
  };
};

export function Simulator({ defaultFrom = "buyer@acme.com", sandbox = false, sandboxEmails = false }: { defaultFrom?: string; sandbox?: boolean; sandboxEmails?: boolean }) {
  const [from, setFrom] = useState(defaultFrom);
  const [subject, setSubject] = useState("New purchase order");
  const [bodyText, setBodyText] = useState(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/po-agent/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, subject, bodyText }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Request failed");
      else setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const s = result?.session;
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Purchase order</h3>
        {sandbox && (
          <p className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn)", display: "inline-block", marginBottom: 12 }}>
            SANDBOX — real submissions ON{sandboxEmails ? " · emails will send" : " · emails suppressed"}
          </p>
        )}
        <div className="field">
          <label>Sender email</label>
          <input value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label>Body</label>
          <textarea rows={10} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
        </div>
        <button className="btn primary" onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run pipeline"}
        </button>
        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
        <p className="muted" style={{ marginTop: 12 }}>
          {sandbox
            ? "Sandbox mode — submits a REAL order/quote to the connected store (tagged “[PO agent sandbox]”)."
            : "Dry run — never submits an order/quote and never sends email."}
        </p>
      </div>

      <div>
        {!result && <div className="card muted">Run a PO to see the pipeline result.</div>}

        {result && !result.storeConfigured && (
          <div className="card">
            <h3>Store not configured</h3>
            <p className="muted">{result.note}</p>
            <pre className="block">{JSON.stringify(result.extracted, null, 2)}</pre>
          </div>
        )}

        {s && (
          <>
            {result?.sandboxBlocked && (
              <div className="card" style={{ borderColor: "var(--warn)" }}>
                <p className="muted" style={{ margin: 0 }}>Sandbox mode is on but this ran as a dry run (Redis or a store token is missing). No order/quote was placed.</p>
              </div>
            )}
            <div className="card">
              <h3>Decision</h3>
              <p style={{ fontSize: 16 }}>
                <span className={`badge ${s.decision?.kind}`}>{s.decision?.kind}</span>{" "}
                <span className="muted">{s.decision?.reasons?.join(", ")}</span>
              </p>
              <p className="muted">{s.buyer?.companyName ?? "—"} · {s.buyer?.email ?? "unknown"}</p>
            </div>

            {result?.sandbox && s.result && (s.result.orderId || s.result.quoteId) && (
              <div className="card">
                <h3>Submitted {result.emailsSent ? "· emails sent" : "· emails captured"}</h3>
                {s.result.orderId && <p>Order <strong className="mono">#{s.result.orderId}</strong> placed in the store.</p>}
                {s.result.quoteId && (
                  <p>
                    Quote <strong className="mono">{s.result.quoteNumber ?? s.result.quoteId}</strong> created.
                    {s.result.checkoutUrl && <> <a href={s.result.checkoutUrl} target="_blank" rel="noreferrer">Checkout link →</a></>}
                  </p>
                )}
                <p className="muted" style={{ fontSize: 12 }}>Tagged “[PO agent sandbox]” — safe to delete in the store.</p>
              </div>
            )}

            {result?.sandbox && !result.emailsSent && result.captured && result.captured.length > 0 && (
              <div className="card">
                <h3>Captured emails ({result.captured.length})</h3>
                {result.captured.map((c, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{c.to ? `to ${c.to} · ` : ""}{c.subject}</div>
                    <pre className="block" style={{ marginTop: 4 }}>{c.text}</pre>
                  </div>
                ))}
              </div>
            )}

            <div className="card">
              <h3>Lines</h3>
              <table className="table">
                <thead><tr><th>SKU</th><th>Qty</th><th>Unit</th><th>Issues</th></tr></thead>
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

            <div className="card">
              <h3>Pipeline steps</h3>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {s.audit?.map((a, i) => (
                  <li key={i}><strong>{a.event}</strong> {a.detail ? <code>{JSON.stringify(a.detail)}</code> : null}</li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
