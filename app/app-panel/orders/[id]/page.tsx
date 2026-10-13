import { Panel } from "@/components/backbone";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Chip, stateLabel } from "@/app/staff/ui";
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-group)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: "var(--text-section-size)", fontWeight: "var(--text-section-weight)" }}>PO Agent</span>
        <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>Order #{id}</span>
      </div>

      {matches.length ? (
        matches.map((s) => (
          <Panel key={s.id} bodyStyle={{ gap: 4 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Chip kind={s.state}>{stateLabel(s.state)}</Chip>
              <span>
                PO <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.extracted?.poNumber ?? "—"}</span>
              </span>
            </span>
            <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
              {s.buyer?.email} · {s.buyer?.companyName}
            </span>
            <span>
              <a href={`/staff/po-inbox/${encodeURIComponent(s.id)}`} target="_blank" rel="noreferrer">Open session ↗</a>
            </span>
          </Panel>
        ))
      ) : (
        <span style={{ color: "var(--text-secondary)" }}>
          This order wasn’t placed by the PO Agent (no matching email session).
        </span>
      )}
    </div>
  );
}
