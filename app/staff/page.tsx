import Link from "next/link";
import { KpiRow, Panel } from "@/components/backbone";
import { LinkButton } from "@/components/ui/link-button";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { computeMetrics, currentYyyymm } from "@/lib/po-agent/metrics";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { PageHead, Stat, HealthRow, SessionRow, stateLabel } from "./ui";
import { Banner, EmptyState } from "@/components/ui/states";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import type { PoSession } from "@/lib/po-agent/types";
import { customerEmail } from "@/lib/po-agent/people";

export const dynamic = "force-dynamic";

const SETTINGS = "/staff/settings";
const INBOX = "/staff/po-inbox";

/** "4 hours" / "12 minutes" / "2 days" — for the escalation call-out. */
function waitedFor(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((nowMs - then) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function poOf(s: PoSession): string {
  return s.extracted?.poNumber || "no PO number";
}

/** "09:42" for today, else "25 Jul" — matches the design's compact row stamps. */
function shortWhen(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sameDay = new Date(t).toDateString() === new Date(nowMs).toDateString();
  if (sameDay) return iso.slice(11, 16);
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function Dashboard() {
  const hash = await sessionStoreHash();
  const status = adminStatus(await effectiveEnv(hash ?? undefined)); // reflects saved settings
  const active = await activeStoreSource();
  const redis = getRedis();
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  let metrics = computeMetrics({});
  let recent: PoSession[] = [];
  let escalated: PoSession[] = [];
  let escalatedCount = 0;
  if (redis) {
    const store = createPoStore(redis);
    const ym = currentYyyymm(nowIso);
    const [counters, recentIds, escalatedIds] = await Promise.all([
      store.getCounters(ym),
      store.listQueue("recent", 6),
      store.listQueue("escalated", 100),
    ]);
    metrics = computeMetrics(counters);
    recent = await store.loadSessions(recentIds);
    escalatedCount = escalatedIds.length;
    escalated = await store.loadSessions(escalatedIds);
  }

  const hasChannel = status.channelCreds.google || status.channelCreds.microsoft;
  const hasEscalation = status.escalation.email || status.escalation.slack;
  const health = [
    { ok: status.enabled, warn: !status.enabled, name: "PO agent", detail: status.enabled ? "enabled" : "disabled", action: { label: "Enable", href: SETTINGS } },
    { ok: active.source !== "none", name: "BigCommerce store", detail: active.storeHash ? `${active.storeHash} · token: ${active.source}` : "not configured", action: { label: "Connect", href: SETTINGS } },
    { ok: status.redis, name: "Redis (state)", detail: status.redis ? "connected" : "not configured", action: { label: "Set up", href: SETTINGS } },
    { ok: status.ai.configured, warn: !status.ai.configured, name: "AI model", detail: status.ai.model ?? "heuristic fallback", action: { label: "Add model", href: SETTINGS } },
    { ok: hasChannel, warn: !hasChannel, name: "Email channel", detail: status.channelCreds.google ? "gmail" : status.channelCreds.microsoft ? "microsoft" : "none", action: { label: "Connect", href: SETTINGS } },
    { ok: hasEscalation, warn: !hasEscalation, name: "Escalation targets", detail: [status.escalation.email && "email", status.escalation.slack && "slack"].filter(Boolean).join(", ") || "queue only", action: { label: "Set up", href: SETTINGS } },
  ];
  const firstRun = health.filter((h) => h.ok).length <= 2;

  // Oldest wait drives the call-out's urgency line.
  const oldest = escalated
    .map((s) => s.escalation?.at ?? s.updatedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const waited = waitedFor(oldest, nowMs);

  const monthLabel = new Date(nowMs).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <>
      <PageHead title="Dashboard" sub={`Email → purchase-order agent for BigCommerce B2B Edition · ${monthLabel}`}>
        <AutoRefresh />
      </PageHead>

      {!redis && (
        <Banner kind="warn" title="Redis not connected">
          Session tracking, the review queue, and metrics are offline. Add <code>UPSTASH_REDIS_REST_URL</code> /{" "}
          <code>UPSTASH_REDIS_REST_TOKEN</code> in <Link href={SETTINGS}>Settings</Link> — the counters below read 0 until then.
        </Banner>
      )}

      {firstRun && (
        <Banner kind="info" title="Finish setup to start processing POs">
          <ol style={{ margin: "6px 0 8px", paddingLeft: 18 }}>
            <li>Connect your <strong>BigCommerce store</strong> and <strong>Redis</strong>.</li>
            <li>Add an <strong>AI model</strong> — optional, a heuristic extractor works without one.</li>
            <li>Connect your <strong>email channel</strong> (Gmail or Microsoft).</li>
            <li><strong>Enable</strong> the agent.</li>
          </ol>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <LinkButton href={SETTINGS} variant="primary">Open settings</LinkButton>
            <LinkButton href="/staff/simulator" variant="secondary">Try the simulator</LinkButton>
          </span>
        </Banner>
      )}

      {escalatedCount > 0 && (
        <Banner kind="error" title={`${escalatedCount} escalated session${escalatedCount === 1 ? " is" : "s are"} waiting on a human`}>
          <span style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span>
              Buyers have been told the order is being checked — nothing was submitted.
              {waited ? ` Oldest has waited ${waited}.` : ""}
            </span>
            <LinkButton href={INBOX} variant="secondary" size="micro" iconAfter="arrow-right">
              Review queue
            </LinkButton>
          </span>
        </Banner>
      )}

      <KpiRow>
        <Stat label="Received" value={metrics.received} note="POs this month" />
        <Stat label="Orders" value={metrics.orders} note="pay on account" />
        <Stat label="Quotes" value={metrics.quotes} note="checkout link sent" />
        <Stat label="Escalations" value={metrics.escalations} note={`${escalatedCount} still open`} tone="bad" />
        <Stat label="Touchless" value={`${Math.round(metrics.touchlessRate * 100)}%`} note="no human needed" tone="ok" />
        <Stat
          label="Value"
          value={`$${metrics.valueProcessed.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          note="orders placed"
        />
      </KpiRow>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--gap-group)", alignItems: "start" }}>
        <Panel
          title="Recent sessions"
          padded={false}
          actions={<LinkButton href="/staff/sessions" variant="ghost" size="micro" iconAfter="arrow-right">All sessions</LinkButton>}
        >
          {recent.length ? (
            recent.map((s) => (
              <SessionRow
                key={s.id}
                href={`${INBOX}/${encodeURIComponent(s.id)}`}
                customer={customerEmail(s)}
                sub={`${s.buyer?.companyName || "No matching account"} · ${poOf(s)} · ${shortWhen(s.updatedAt, nowMs)}`}
                state={s.state}
                stateLabel={stateLabel(s.state)}
              />
            ))
          ) : (
            <div style={{ padding: "var(--panel-pad)" }}>
              <EmptyState title="No sessions yet">Processed POs appear here as they arrive.</EmptyState>
            </div>
          )}
        </Panel>

        <Panel title="Setup & health">
          {health.map((h) => (
            <HealthRow key={h.name} ok={h.ok} warn={h.warn} name={h.name} detail={h.detail} action={h.action} />
          ))}
        </Panel>
      </div>
    </>
  );
}
