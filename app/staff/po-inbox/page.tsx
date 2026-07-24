import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Badge } from "../ui";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function PoInboxPage() {
  const redis = getRedis();
  if (!redis) {
    return (
      <>
        <h1>Inbox</h1>
        <div className="card muted">Redis is not configured (UPSTASH_REDIS_REST_URL / TOKEN). The review queue is unavailable.</div>
      </>
    );
  }
  const store = createPoStore(redis);
  const [escalatedIds, recentIds] = await Promise.all([store.listQueue("escalated", 50), store.listQueue("recent", 25)]);
  const escalated = await store.loadSessions(escalatedIds);
  const recent = await store.loadSessions(recentIds);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">Escalated sessions need a human; recent shows the latest activity.</p>
        </div>
      </div>

      <div className="card">
        <h3>Escalated ({escalated.length})</h3>
        <SessionTable sessions={escalated} empty="No escalations — the queue is clear." />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent ({recent.length})</h3>
        <SessionTable sessions={recent} empty="No sessions yet." />
      </div>
    </>
  );
}

function SessionTable({ sessions, empty }: { sessions: PoSession[]; empty: string }) {
  if (!sessions.length) return <p className="muted">{empty}</p>;
  return (
    <table className="table">
      <thead>
        <tr><th>Company</th><th>Buyer</th><th>State</th><th>Reason / decision</th><th>Updated</th></tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.id}>
            <td><Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName ?? "—"}</Link></td>
            <td className="muted">{s.buyer?.email ?? "—"}</td>
            <td><Badge kind={s.state}>{s.state}</Badge></td>
            <td className="muted">{s.escalation?.reasons.join(", ") || s.decision?.reasons.join(", ") || s.decision?.kind || "—"}</td>
            <td className="muted mono">{s.updatedAt.slice(0, 16).replace("T", " ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
