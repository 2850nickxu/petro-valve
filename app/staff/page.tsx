import Link from "next/link";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { computeMetrics, currentYyyymm } from "@/lib/po-agent/metrics";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { Stat, Badge, HealthRow } from "./ui";
import { Banner } from "@/components/ui/states";
import { Timestamp } from "@/components/ui/timestamp";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

const SETTINGS = "/staff/settings";

export default async function Dashboard() {
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const status = adminStatus(await effectiveEnv(hash ?? undefined)); // reflects saved settings
  const active = await activeStoreSource();
  const redis = getRedis();

  let metrics = computeMetrics({});
  let recent: PoSession[] = [];
  let escalated: PoSession[] = [];
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
    escalated = await store.loadSessions(escalatedIds.slice(0, 5));
  }

  const hasChannel = status.channelCreds.google || status.channelCreds.microsoft;
  const hasEscalation = status.escalation.email || status.escalation.slack;
  const health = [
    { ok: status.enabled, warn: !status.enabled, name: "PO agent enabled", detail: status.enabled ? "on" : "off", action: { label: "Enable →", href: SETTINGS } },
    { ok: active.source !== "none", name: "BigCommerce store", detail: active.storeHash ? `${active.storeHash} · token: ${active.source}` : "not configured", action: { label: "Connect →", href: SETTINGS } },
    { ok: status.redis, name: "Redis (state)", detail: status.redis ? "connected" : "not configured", action: { label: "Set up →", href: SETTINGS } },
    { ok: status.ai.configured, warn: !status.ai.configured, name: "AI model", detail: status.ai.model ?? "heuristic fallback", action: { label: "Add model →", href: SETTINGS } },
    { ok: hasChannel, warn: !hasChannel, name: "Email channel", detail: status.channelCreds.google ? "gmail" : status.channelCreds.microsoft ? "microsoft" : "none", action: { label: "Connect →", href: SETTINGS } },
    { ok: hasEscalation, warn: !hasEscalation, name: "Escalation targets", detail: [status.escalation.email && "email", status.escalation.slack && "slack"].filter(Boolean).join(", ") || "queue only", action: { label: "Set up →", href: SETTINGS } },
  ];
  const okCount = health.filter((h) => h.ok).length;
  const firstRun = okCount <= 2;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Email → purchase-order agent for BigCommerce B2B Edition.</p>
        </div>
        <AutoRefresh />
      </div>

      {!redis && (
        <Banner kind="warn" title="Redis not connected">
          Session tracking, the review queue, and metrics are offline. Add <code>UPSTASH_REDIS_REST_URL</code> / <code>_TOKEN</code> in{" "}
          <Link href={SETTINGS}>Settings</Link> — the counters below read 0 until then.
        </Banner>
      )}

      {firstRun && (
        <Banner kind="info" title="Get started">
          <p className="mb-1">Finish setup to start processing POs:</p>
          <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            <li>Connect your <strong>BigCommerce store</strong> and <strong>Redis</strong> in Settings.</li>
            <li>Add an <strong>AI model</strong> (optional — a heuristic extractor works without one).</li>
            <li>Connect your <strong>email channel</strong> (Gmail or Microsoft).</li>
            <li><strong>Enable</strong> the agent.</li>
          </ol>
          <div className="wrap">
            <Link className="btn primary" href={SETTINGS}>Open Settings</Link>
            <Link className="btn" href="/staff/simulator">Try the simulator</Link>
          </div>
        </Banner>
      )}

      <div className="stat-grid mt-3 mb-3">
        <Stat label="Received (mo)" value={metrics.received} hint="POs received this calendar month" />
        <Stat label="Orders" value={metrics.orders} hint="Orders placed this month" />
        <Stat label="Quotes" value={metrics.quotes} hint="Quotes created this month" />
        <Stat label="Escalations" value={metrics.escalations} hint="Sessions sent to human review this month" />
        <Stat label="Touchless" value={`${Math.round(metrics.touchlessRate * 100)}%`} hint="Share completed without human review" />
        <Stat label="Value" value={`$${metrics.valueProcessed.toFixed(0)}`} hint="Total order value placed this month (USD)" />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Setup &amp; health</h3>
          <div className="health">
            {health.map((h) => (
              <HealthRow key={h.name} ok={h.ok} warn={h.warn} name={h.name} detail={h.detail} action={h.action} />
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Needs review</h3>
          {!redis ? (
            <p className="muted">Connect Redis to track the review queue.</p>
          ) : escalatedCount > 0 ? (
            <>
              <p>
                <span className="badge escalate">{escalatedCount}</span> escalated session{escalatedCount === 1 ? "" : "s"} waiting.{" "}
                <Link href="/staff/po-inbox">Open inbox →</Link>
              </p>
              <table className="table mt-2">
                <tbody>
                  {escalated.map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName || "—"}</Link></td>
                      <td className="muted">{s.escalation?.reasons.join(", ") || s.decision?.reasons.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted">No escalations. Queue is clear.</p>
          )}
        </div>
      </div>

      <div className="card mt-3">
        <h3>Recent sessions</h3>
        {recent.length ? (
          <table className="table">
            <thead>
              <tr><th>Company</th><th>Buyer</th><th>State</th><th>Decision</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}>{s.buyer?.companyName || "—"}</Link></td>
                  <td className="muted">{s.buyer?.email ?? "—"}</td>
                  <td><Badge kind={s.state}>{s.state}</Badge></td>
                  <td>{s.decision?.kind ?? "—"}</td>
                  <td><Timestamp iso={s.updatedAt} /></td>
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
