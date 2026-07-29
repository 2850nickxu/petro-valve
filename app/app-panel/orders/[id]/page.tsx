import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { stateLabel } from "@/app/staff/ui";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function OrderPanel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);

  let matches: PoSession[] = [];
  const redis = getRedis();
  if (redis) {
    const store = createPoStore(redis);
    const ids = await store.listQueue("recent", 300);
    const sessions = await store.loadSessions(ids);
    matches = sessions.filter((s) => s.result?.orderId === orderId);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>PO Agent</h2>
      <p className="muted" style={{ marginTop: -6 }}>Order #{id}</p>
      {matches.length ? (
        matches.map((s) => (
          <div key={s.id} className="card pad mb-2">
            <p style={{ marginTop: 0 }}>
              <span className={`chip ${s.state}`}>{stateLabel(s.state)}</span> · PO{" "}
              <strong className="num">{s.extracted?.poNumber ?? "—"}</strong>
            </p>
            <p className="muted">{s.buyer?.companyName} · {s.buyer?.email}</p>
            <p className="mb-0">
              <a href={`/staff/po-inbox/${encodeURIComponent(s.id)}`} target="_blank" rel="noreferrer">Open session ↗</a>
            </p>
          </div>
        ))
      ) : (
        <p className="muted">This order wasn’t placed by the PO Agent (no matching email session).</p>
      )}
    </div>
  );
}
