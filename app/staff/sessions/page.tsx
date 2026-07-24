import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Badge } from "../ui";
import type { PoSession, PoSessionState } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

const STATES: Array<PoSessionState | "all"> = [
  "all", "completed_order", "completed_quote", "clarifying", "awaiting_confirmation", "escalated", "rejected", "expired",
];

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const filter = (state ?? "all") as PoSessionState | "all";

  const redis = getRedis();
  if (!redis) {
    return (
      <>
        <h1>Sessions</h1>
        <div className="card muted">Redis is not configured — no sessions to show.</div>
      </>
    );
  }
  const store = createPoStore(redis);
  const ids = await store.listQueue("recent", 200);
  let sessions: PoSession[] = await store.loadSessions(ids);
  if (filter !== "all") sessions = sessions.filter((s) => s.state === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="muted">{sessions.length} session{sessions.length === 1 ? "" : "s"}{filter !== "all" ? ` · ${filter}` : ""}</p>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        {STATES.map((st) => (
          <Link key={st} href={st === "all" ? "/staff/sessions" : `/staff/sessions?state=${st}`} className="tag" style={filter === st ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" } : undefined}>
            {st}
          </Link>
        ))}
      </div>

      <div className="card">
        {sessions.length ? (
          <table className="table">
            <thead>
              <tr><th>Company</th><th>Buyer</th><th>State</th><th>Decision</th><th>PO</th><th>Result</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName ?? "—"}</Link></td>
                  <td className="muted">{s.buyer?.email ?? "—"}</td>
                  <td><Badge kind={s.state}>{s.state}</Badge></td>
                  <td>{s.decision?.kind ?? "—"}</td>
                  <td className="mono">{s.extracted?.poNumber ?? "—"}</td>
                  <td className="mono">{s.result?.orderId ? `order ${s.result.orderId}` : s.result?.quoteId ? `quote ${s.result.quoteNumber ?? s.result.quoteId}` : "—"}</td>
                  <td className="muted mono">{s.updatedAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No sessions{filter !== "all" ? ` in state "${filter}"` : ""}.</p>
        )}
      </div>
    </>
  );
}
