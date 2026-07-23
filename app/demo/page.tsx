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
  session?: {
    state: string;
    decision?: { kind: string; reasons: string[] };
    buyer?: { companyName?: string; email?: string };
    validation?: Array<{ kind: string; message: string; lineRef?: string }>;
    resolution?: Array<{ matchedSku?: string; productId?: number; calculatedUnitPrice?: number; issues: string[]; line: { rawText: string; quantity: number | null } }>;
    audit?: Array<{ at: string; event: string; detail?: unknown }>;
  };
};

export default function DemoPage() {
  const [from, setFrom] = useState("buyer@acme.com");
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
    <main style={{ padding: 32, maxWidth: 920, margin: "0 auto" }}>
      <h1>PO Agent — Demo Simulator</h1>
      <p style={{ color: "#556" }}>
        Paste a purchase order and run the pipeline. This is a dry run — it never submits an
        order/quote and never sends email.
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <label>
          Sender email
          <input value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inp} />
        </label>
        <label>
          Purchase order
          <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={9} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
        </label>
      </div>
      <button onClick={run} disabled={loading} style={btn}>
        {loading ? "Running…" : "Run pipeline"}
      </button>

      {error && <p style={{ color: "#b00" }}>{error}</p>}

      {result && !result.storeConfigured && (
        <section style={card}>
          <strong>Store not configured.</strong>
          <p style={{ color: "#556" }}>{result.note}</p>
          <h3>Extraction (heuristic)</h3>
          <pre style={pre}>{JSON.stringify(result.extracted, null, 2)}</pre>
        </section>
      )}

      {s && (
        <section style={{ display: "grid", gap: 16, marginTop: 16 }}>
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Decision</h3>
            <p>
              <Badge kind={s.decision?.kind} /> — {s.decision?.reasons?.join(", ")}
            </p>
            <p style={{ color: "#556" }}>
              Buyer: {s.buyer?.companyName ?? "—"} ({s.buyer?.email ?? "unknown"}) · state: {s.state}
            </p>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Lines</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <Th>Raw</Th><Th>SKU</Th><Th>Qty</Th><Th>Unit price</Th><Th>Issues</Th>
                </tr>
              </thead>
              <tbody>
                {s.resolution?.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.line.rawText}</Td>
                    <Td>{r.matchedSku ?? "—"}</Td>
                    <Td>{r.line.quantity ?? "—"}</Td>
                    <Td>{r.calculatedUnitPrice != null ? `$${r.calculatedUnitPrice.toFixed(2)}` : "—"}</Td>
                    <Td>{r.issues.join(", ") || "ok"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {s.validation && s.validation.length > 0 && (
            <div style={card}>
              <h3 style={{ marginTop: 0 }}>Issues</h3>
              <ul>
                {s.validation.map((v, i) => (
                  <li key={i}>
                    <code>{v.kind}</code> {v.lineRef ? `(${v.lineRef})` : ""} — {v.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Pipeline steps</h3>
            <ol style={{ fontSize: 14 }}>
              {s.audit?.map((a, i) => (
                <li key={i}>
                  <strong>{a.event}</strong> {a.detail ? <code>{JSON.stringify(a.detail)}</code> : null}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
    </main>
  );
}

function Badge({ kind }: { kind?: string }) {
  const color = kind === "order" ? "#0a7" : kind === "quote" ? "#07a" : kind === "reject" ? "#a33" : "#a70";
  return <span style={{ background: color, color: "white", padding: "2px 10px", borderRadius: 12, fontWeight: 600 }}>{kind ?? "—"}</span>;
}
const Th = ({ children }: { children: React.ReactNode }) => <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 4 }}>{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td style={{ borderBottom: "1px solid #f0f0f0", padding: 4 }}>{children}</td>;

const inp: React.CSSProperties = { display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "8px 16px", background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" };
const card: React.CSSProperties = { border: "1px solid #e3e3e8", borderRadius: 8, padding: 16 };
const pre: React.CSSProperties = { background: "#f7f7f9", padding: 12, borderRadius: 6, overflow: "auto", fontSize: 12 };
