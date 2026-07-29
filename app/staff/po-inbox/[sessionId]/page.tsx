import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { adminLinks } from "@/lib/bc/admin-links";
import { summarizeOutcome } from "@/lib/po-agent/summary";
import { describeIssue } from "@/lib/po-agent/core/validate";
import { Badge } from "../../ui";
import { Banner } from "@/components/ui/states";
import { Disclosure } from "@/components/ui/section";
import { Timestamp } from "@/components/ui/timestamp";
import { formatMoney } from "@/components/ui/money";
import { SessionActions } from "./actions";
import type { DecisionKind } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

const BANNER_KIND: Record<DecisionKind | "pending", "info" | "warn" | "error" | "ok"> = {
  order: "ok",
  quote: "ok",
  escalate: "warn",
  clarify: "warn",
  reject: "error",
  pending: "info",
};

export default async function SessionDetail({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);

  const redis = getRedis();
  if (!redis) return <Banner kind="error" title="Redis not configured">The review queue and session store are unavailable.</Banner>;
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return (
    <>
      <h1>Session</h1>
      <div className="card">Not found: <code>{id}</code>. <Link href="/staff/po-inbox">Back to inbox</Link></div>
    </>
  );

  const links = adminLinks((await activeStoreSource()).storeHash);
  const currency = session.extracted?.currency;
  const outcome = summarizeOutcome(session);
  const lines = session.resolution ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{session.buyer?.companyName || "Session"}</h1>
          <p className="muted">
            {session.buyer?.email ?? "unknown sender"} · <Badge kind={session.state}>{session.state}</Badge>{" "}
            {session.decision && <span className="tag">decision: {session.decision.kind}</span>}
            {session.extracted?.poNumber && <> · <span className="mono">PO {session.extracted.poNumber}</span></>}
          </p>
        </div>
        <Link href="/staff/po-inbox" className="btn">← Inbox</Link>
      </div>

      <Banner kind={BANNER_KIND[outcome.kind]} title={outcome.headline}>
        {outcome.reasons.length ? (
          <ul className="mt-1" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {outcome.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        ) : "No blocking issues."}
      </Banner>

      <div className="card mt-3">
        <h3>Actions</h3>
        <SessionActions sessionId={id} />
      </div>

      {session.result && (session.result.orderId || session.result.quoteId) && (
        <div className="card">
          <h3>Result</h3>
          <div className="kv">
            {session.result.orderId != null && (
              <>
                <span className="k">Order</span>
                <span className="mono">
                  #{session.result.orderId}
                  {links && <> · <a href={links.order(session.result.orderId)} target="_blank" rel="noreferrer">view in BigCommerce ↗</a></>}
                </span>
              </>
            )}
            {session.result.quoteId != null && (<><span className="k">Quote</span><span className="mono">{session.result.quoteNumber ?? session.result.quoteId}</span></>)}
            {session.result.checkoutUrl && (<><span className="k">Checkout link</span><span><a href={session.result.checkoutUrl} target="_blank" rel="noreferrer">open ↗</a></span></>)}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Buyer</h3>
        <div className="kv">
          <span className="k">Company</span><span>{session.buyer?.companyName || "—"}</span>
          <span className="k">Contact</span><span className="mono">{session.buyer?.email ?? "—"}</span>
          {session.buyer?.customerId != null && (
            <>
              <span className="k">Customer</span>
              <span className="mono">
                #{session.buyer.customerId}
                {links && <> · <a href={links.customer(session.buyer.customerId)} target="_blank" rel="noreferrer">view in BigCommerce ↗</a></>}
              </span>
            </>
          )}
          {session.escalation && (<><span className="k">Notified</span><span>{session.escalation.notified.join(", ") || "—"}</span></>)}
        </div>
      </div>

      <div className="card">
        <h3>Lines</h3>
        {lines.length ? (
          <table className="table">
            <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Stated</th><th>Contract</th><th>Status</th></tr></thead>
            <tbody>
              {lines.map((r, i) => {
                const stated = r.line.statedUnitPrice ?? undefined;
                const contract = r.calculatedUnitPrice ?? undefined;
                const mismatch = stated != null && contract != null && Math.abs(stated - contract) >= 0.005;
                const pct = mismatch && contract ? Math.round(((stated! - contract) / contract) * 100) : 0;
                const issueText = r.issues.map(describeIssue).join(" ");
                return (
                  <tr key={i}>
                    <td>{r.productName ?? <span className="muted">unmatched</span>}</td>
                    <td className="mono">{r.matchedSku ?? r.line.sku ?? r.line.rawText.slice(0, 24)}</td>
                    <td>{r.line.quantity ?? "—"}</td>
                    <td className="mono">{formatMoney(stated, currency)}</td>
                    <td className="mono">
                      {formatMoney(contract, currency)}
                      {mismatch && <> <span className={`delta ${pct >= 0 ? "up" : "down"}`}>{pct >= 0 ? "+" : ""}{pct}%</span></>}
                    </td>
                    <td className={r.issues.length ? "" : "muted"}>{issueText || "OK"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="muted">No resolved lines.</p>}
      </div>

      <div className="card">
        <h3>Original email</h3>
        {session.inbound ? (
          <>
            <div className="kv mb-2">
              <span className="k">From</span><span className="mono">{session.inbound.from}</span>
              <span className="k">Subject</span><span>{session.inbound.subject || "—"}</span>
            </div>
            <pre className="block">{session.inbound.bodyText || "(empty body)"}</pre>
          </>
        ) : (
          <p className="muted">Original email not stored for this session (it predates capture, or was a simulator run).</p>
        )}
      </div>

      <div className="card">
        <h3>Audit trail</h3>
        <ol className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {session.audit.map((a, i) => (
            <li key={i} style={{ marginTop: i ? 8 : 0 }}>
              <Timestamp iso={a.at} /> <strong>{a.event}</strong>
              {a.actor ? <span className="tag" style={{ marginLeft: 6 }}>{a.actor}</span> : null}
              {a.note ? <div className="mt-1">{a.note}</div> : null}
              {a.detail != null ? <div className="mono muted mt-1" style={{ fontSize: 11.5 }}>{JSON.stringify(a.detail)}</div> : null}
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <Disclosure title="Raw extraction (JSON)">
          <pre className="block">{JSON.stringify(session.extracted, null, 2)}</pre>
        </Disclosure>
      </div>
    </>
  );
}
