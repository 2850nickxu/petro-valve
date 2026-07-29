import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { stateLabel } from "@/app/staff/ui";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function CustomerPanel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customerId = Number(id);

  let matches: PoSession[] = [];
  const redis = getRedis();
  if (redis) {
    const store = createPoStore(redis);
    const ids = await store.listQueue("recent", 300);
    const sessions = await store.loadSessions(ids);
    matches = sessions.filter((s) => s.buyer?.customerId === customerId);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>PO Agent</h2>
      <p className="muted" style={{ marginTop: -6 }}>Customer #{id}</p>
      {matches.length ? (
        <>
          <p className="muted">{matches.length} PO session{matches.length === 1 ? "" : "s"} from this customer.</p>
          {matches.slice(0, 15).map((s) => (
            <div key={s.id} className="card pad mb-2">
              <p style={{ margin: 0 }}>
                <span className={`chip ${s.state}`}>{stateLabel(s.state)}</span> · PO{" "}
                <span className="num">{s.extracted?.poNumber ?? "—"}</span>
                {s.result?.orderId ? ` · order ${s.result.orderId}` : s.result?.quoteId ? ` · quote ${s.result.quoteNumber ?? s.result.quoteId}` : ""}
              </p>
              <p style={{ margin: "4px 0 0" }}>
                <a href={`/staff/po-inbox/${encodeURIComponent(s.id)}`} target="_blank" rel="noreferrer">Open ↗</a>
              </p>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">No PO Agent email activity from this customer yet.</p>
      )}
    </div>
  );
}
