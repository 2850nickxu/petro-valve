import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { computeMetrics, currentYyyymm } from "@/lib/po-agent/metrics";
import { adminStatus, isOperational } from "@/lib/po-agent/admin-status";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { Stat, Badge, HealthRow } from "./ui";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const status = adminStatus();
  const active = await activeStoreSource();
  const redis = getRedis();

  let metrics = computeMetrics({});
  let recent: PoSession[] = [];
  let escalatedCount = 0;
  if (redis) {
    const store = createPoStore(redis);
    const ym = currentYyyymm(new Date().toISOString());
    const [counters, recentIds, escalatedIds] = await Promise.all([
      store.getCounters(ym),
      store.listQueue("recent", 8),
      store.listQueue("escalated", 100),
    ]);
    metrics = computeMetrics(counters);
    recent = await store.loadSessions(recentIds);
    escalatedCount = escalatedIds.length;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Email → purchase-order agent for BigCommerce B2B Edition.</p>
        </div>
        <div className="toolbar">
          <Badge kind={isOperational(status) ? "order" : "muted"}>
            {isOperational(status) ? "Operational" : status.enabled ? "Incomplete setup" : "Disabled"}
          </Badge>
          <span className="tag">mode: {status.mode}</span>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Received (mo)" value={metrics.received} />
        <Stat label="Orders" value={metrics.orders} />
        <Stat label="Quotes" value={metrics.quotes} />
        <Stat label="Escalations" value={metrics.escalations} />
        <Stat label="Touchless" value={`${Math.round(metrics.touchlessRate * 100)}%`} />
        <Stat label="Value" value={`$${metrics.valueProcessed.toFixed(0)}`} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>System health</h3>
          <div className="health">
            <HealthRow ok={status.enabled} name="PO agent enabled" detail={status.enabled ? "on" : "PO_AGENT_ENABLED"} warn={!status.enabled} />
            <HealthRow ok={active.source !== "none"} name="BigCommerce store" detail={active.storeHash ? `${active.storeHash} · token: ${active.source}` : "not configured"} />
            <HealthRow ok={status.redis} name="Redis (state)" detail={status.redis ? "connected" : "not configured"} />
            <HealthRow ok={status.ai.configured} name="AI model" detail={status.ai.model ?? "heuristic fallback"} warn={!status.ai.configured} />
            <HealthRow ok={status.channelCreds.google || status.channelCreds.microsoft} name="Email channel" detail={status.channelCreds.google ? "gmail" : status.channelCreds.microsoft ? "microsoft" : "none"} warn={!status.channelCreds.google && !status.channelCreds.microsoft} />
            <HealthRow ok={status.escalation.email || status.escalation.slack} name="Escalation targets" detail={[status.escalation.email && "email", status.escalation.slack && "slack"].filter(Boolean).join(", ") || "queue only"} warn={!status.escalation.email && !status.escalation.slack} />
          </div>
        </div>

        <div className="card">
          <h3>Needs review</h3>
          {escalatedCount > 0 ? (
            <p>
              <span className="badge escalate">{escalatedCount}</span> escalated session{escalatedCount === 1 ? "" : "s"} waiting.{" "}
              <Link href="/staff/po-inbox">Open inbox →</Link>
            </p>
          ) : (
            <p className="muted">No escalations. {redis ? "Queue is clear." : "Connect Redis to track sessions."}</p>
          )}
          <h3 style={{ marginTop: 18 }}>Try it</h3>
          <p className="muted">Paste a PO and watch the pipeline run (dry run, no submit).</p>
          <Link className="btn primary" href="/staff/simulator">Open simulator</Link>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent sessions</h3>
        {recent.length ? (
          <table className="table">
            <thead>
              <tr><th>Company</th><th>Buyer</th><th>State</th><th>Decision</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName ?? "—"}</Link></td>
                  <td className="muted">{s.buyer?.email ?? "—"}</td>
                  <td><Badge kind={s.state}>{s.state}</Badge></td>
                  <td>{s.decision?.kind ?? "—"}</td>
                  <td className="muted mono">{s.updatedAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No sessions yet.</p>
        )}
      </div>
    </>
  );
}
