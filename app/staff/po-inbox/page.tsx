import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { computeMetrics, currentYyyymm, type Metrics } from "@/lib/po-agent/metrics";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function PoInboxPage() {
  const redis = getRedis();
  if (!redis) {
    return (
      <Shell>
        <p style={{ color: "#a33" }}>
          Redis is not configured (UPSTASH_REDIS_REST_URL / TOKEN). The review queue is unavailable.
        </p>
      </Shell>
    );
  }
  const store = createPoStore(redis);
  const ym = currentYyyymm(new Date().toISOString());
  const [counters, escalatedIds, recentIds] = await Promise.all([
    store.getCounters(ym),
    store.listQueue("escalated", 50),
    store.listQueue("recent", 50),
  ]);
  const metrics = computeMetrics(counters);
  const escalated = await store.loadSessions(escalatedIds);
  const recent = await store.loadSessions(recentIds);

  return (
    <Shell>
      <MetricsStrip m={metrics} />
      <h2>Escalated ({escalated.length})</h2>
      <SessionTable sessions={escalated} />
      <h2 style={{ marginTop: 24 }}>Recent ({recent.length})</h2>
      <SessionTable sessions={recent} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ padding: 32, maxWidth: 1000, margin: "0 auto" }}>
      <h1>PO Inbox</h1>
      {children}
    </main>
  );
}

function MetricsStrip({ m }: { m: Metrics }) {
  const items: Array<[string, string]> = [
    ["Received", String(m.received)],
    ["Orders", String(m.orders)],
    ["Quotes", String(m.quotes)],
    ["Escalations", String(m.escalations)],
    ["Touchless", `${Math.round(m.touchlessRate * 100)}%`],
    ["Value", `$${m.valueProcessed.toFixed(2)}`],
  ];
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0 24px" }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ border: "1px solid #e3e3e8", borderRadius: 8, padding: "10px 16px", minWidth: 96 }}>
          <div style={{ fontSize: 12, color: "#667" }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function SessionTable({ sessions }: { sessions: PoSession[] }) {
  if (!sessions.length) return <p style={{ color: "#889" }}>None.</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr>
          {["Company", "Buyer", "State", "Decision", "Updated"].map((h) => (
            <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.id}>
            <td style={td}>
              <Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName ?? "—"}</Link>
            </td>
            <td style={td}>{s.buyer?.email ?? "—"}</td>
            <td style={td}>{s.state}</td>
            <td style={td}>{s.decision?.kind ?? "—"}</td>
            <td style={td}>{s.updatedAt.slice(0, 16).replace("T", " ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const td: React.CSSProperties = { borderBottom: "1px solid #f0f0f0", padding: 6 };
