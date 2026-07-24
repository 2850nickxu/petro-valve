import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Badge } from "../../ui";
import { SessionActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function SessionDetail({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);

  const redis = getRedis();
  if (!redis) return <div className="card muted">Redis not configured.</div>;
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return (
    <>
      <h1>Session</h1>
      <div className="card">Not found: <code>{id}</code>. <Link href="/staff/po-inbox">Back to inbox</Link></div>
    </>
  );

  const money = (n?: number) => (n != null ? `$${n.toFixed(2)}` : "—");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{session.buyer?.companyName ?? "Session"}</h1>
          <p className="muted">
            {session.buyer?.email ?? "unknown"} · <Badge kind={session.state}>{session.state}</Badge>{" "}
            {session.decision && <span className="tag">decision: {session.decision.kind}</span>}
          </p>
        </div>
        <Link href="/staff/po-inbox" className="btn">← Inbox</Link>
      </div>

      <div className="card">
        <h3>Actions</h3>
        <SessionActions sessionId={id} />
      </div>

      {session.result && (session.result.orderId || session.result.quoteId) && (
        <div className="card">
          <h3>Result</h3>
          <div className="kv">
            {session.result.orderId && (<><span className="k">Order</span><span className="mono">{session.result.orderId}</span></>)}
            {session.result.quoteId && (<><span className="k">Quote</span><span className="mono">{session.result.quoteNumber ?? session.result.quoteId}</span></>)}
            {session.result.checkoutUrl && (<><span className="k">Checkout link</span><span><a href={session.result.checkoutUrl}>open</a></span></>)}
          </div>
        </div>
      )}

      {session.escalation && (
        <div className="card">
          <h3>Escalation</h3>
          <div className="kv">
            <span className="k">Reasons</span><span>{session.escalation.reasons.join(", ")}</span>
            <span className="k">Notified</span><span>{session.escalation.notified.join(", ")}</span>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Lines</h3>
        <table className="table">
          <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Issues</th></tr></thead>
          <tbody>
            {(session.resolution ?? []).map((r, i) => (
              <tr key={i}>
                <td className="mono">{r.matchedSku ?? r.line.sku ?? r.line.rawText.slice(0, 28)}</td>
                <td>{r.line.quantity ?? "—"}</td>
                <td>{money(r.calculatedUnitPrice ?? r.line.statedUnitPrice ?? undefined)}</td>
                <td className="muted">{r.issues.join(", ") || "ok"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {session.validation && session.validation.length > 0 && (
        <div className="card">
          <h3>Issues</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {session.validation.map((v, i) => (<li key={i}><code>{v.kind}</code> — {v.message}</li>))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>Extracted</h3>
        <pre className="block">{JSON.stringify(session.extracted, null, 2)}</pre>
      </div>

      <div className="card">
        <h3>Audit trail</h3>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {session.audit.map((a, i) => (
            <li key={i}><code>{a.at.slice(11, 19)}</code> <strong>{a.event}</strong> {a.detail ? <code>{JSON.stringify(a.detail)}</code> : null}</li>
          ))}
        </ol>
      </div>
    </>
  );
}
