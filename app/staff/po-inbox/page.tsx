import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Badge } from "../ui";
import { Banner, EmptyState } from "@/components/ui/states";
import { Timestamp } from "@/components/ui/timestamp";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function PoInboxPage() {
  const redis = getRedis();
  if (!redis) {
    return (
      <>
        <div className="page-head"><div><h1>Inbox</h1></div></div>
        <Banner kind="error" title="Redis is not configured">
          The review queue is unavailable. Set <code>UPSTASH_REDIS_REST_URL</code> and <code>UPSTASH_REDIS_REST_TOKEN</code> in
          {" "}<Link href="/staff/settings">Settings</Link> to track and review PO sessions.
        </Banner>
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
        <AutoRefresh />
      </div>

      <div className="card">
        <h3>Escalated ({escalated.length})</h3>
        {escalated.length
          ? <SessionTable sessions={escalated} showReason />
          : <EmptyState icon="✓" title="Queue is clear">No sessions are waiting for review.</EmptyState>}
      </div>

      <div className="card mt-3">
        <h3>Recent ({recent.length})</h3>
        {recent.length
          ? <SessionTable sessions={recent} showReason />
          : <EmptyState title="No sessions yet">Processed POs will appear here as they arrive.</EmptyState>}
      </div>
    </>
  );
}

function SessionTable({ sessions, showReason }: { sessions: PoSession[]; showReason?: boolean }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Company</th><th>Buyer</th><th>State</th>{showReason && <th>Reason / decision</th>}<th>Updated</th></tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.id}>
            <td><Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName || "—"}</Link></td>
            <td className="muted">{s.buyer?.email ?? "—"}</td>
            <td><Badge kind={s.state}>{s.state}</Badge></td>
            {showReason && <td className="muted">{s.escalation?.reasons.join(", ") || s.decision?.reasons.join(", ") || s.decision?.kind || "—"}</td>}
            <td><Timestamp iso={s.updatedAt} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
