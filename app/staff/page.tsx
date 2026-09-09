import Link from "next/link";
import { cookies } from "next/headers";
import { Box, Button, Flex, Grid, Panel, Text } from "@bigcommerce/big-design";
import { colors } from "@bigcommerce/big-design-theme";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { computeMetrics, currentYyyymm } from "@/lib/po-agent/metrics";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { PageHead, Stat, HealthRow, SessionRow, stateLabel } from "./ui";
import { Banner, EmptyState } from "@/components/ui/states";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import type { PoSession } from "@/lib/po-agent/types";

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
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
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
    { ok: status.enabled, warn: !status.enabled, name: "PO agent", detail: status.enabled ? "enabled" : "disabled", action: { label: "Enable →", href: SETTINGS } },
    { ok: active.source !== "none", name: "BigCommerce store", detail: active.storeHash ? `${active.storeHash} · token: ${active.source}` : "not configured", action: { label: "Connect →", href: SETTINGS } },
    { ok: status.redis, name: "Redis (state)", detail: status.redis ? "connected" : "not configured", action: { label: "Set up →", href: SETTINGS } },
    { ok: status.ai.configured, warn: !status.ai.configured, name: "AI model", detail: status.ai.model ?? "heuristic fallback", action: { label: "Add model →", href: SETTINGS } },
    { ok: hasChannel, warn: !hasChannel, name: "Email channel", detail: status.channelCreds.google ? "gmail" : status.channelCreds.microsoft ? "microsoft" : "none", action: { label: "Connect →", href: SETTINGS } },
    { ok: hasEscalation, warn: !hasEscalation, name: "Escalation targets", detail: [status.escalation.email && "email", status.escalation.slack && "slack"].filter(Boolean).join(", ") || "queue only", action: { label: "Set up →", href: SETTINGS } },
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
      <PageHead
        title="Dashboard"
        sub={`Email → purchase-order agent for BigCommerce B2B Edition · ${monthLabel}`}
      >
        <AutoRefresh />
      </PageHead>

      {!redis && (
        <Box marginBottom="medium">
          <Banner kind="warn" title="Redis not connected">
            Session tracking, the review queue, and metrics are offline. Add <code>UPSTASH_REDIS_REST_URL</code> /{" "}
            <code>UPSTASH_REDIS_REST_TOKEN</code> in <Link href={SETTINGS}>Settings</Link> — the counters below read 0 until then.
          </Banner>
        </Box>
      )}

      {firstRun && (
        <Box marginBottom="medium">
          <Banner kind="info" title="Finish setup to start processing POs">
            <ol style={{ margin: "6px 0 8px", paddingLeft: 18 }}>
              <li>Connect your <strong>BigCommerce store</strong> and <strong>Redis</strong>.</li>
              <li>Add an <strong>AI model</strong> — optional, a heuristic extractor works without one.</li>
              <li>Connect your <strong>email channel</strong> (Gmail or Microsoft).</li>
              <li><strong>Enable</strong> the agent.</li>
            </ol>
            <Flex flexWrap="wrap" style={{ gap: 10 }}>
              <Link href={SETTINGS}>
                <Button variant="primary">Open Settings</Button>
              </Link>
              <Link href="/staff/simulator">
                <Button variant="secondary">Try the simulator</Button>
              </Link>
            </Flex>
          </Banner>
        </Box>
      )}

      {escalatedCount > 0 && (
        <Box
          marginBottom="large"
          backgroundColor="danger10"
          border="box"
          borderRadius="normal"
          style={{ borderLeftWidth: 4, borderLeftColor: colors.danger40 }}
        >
          <Link
            href={INBOX}
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", color: "inherit", textDecoration: "none" }}
          >
            <Box style={{ minWidth: 0 }}>
              <Text bold color="danger" marginBottom="none" style={{ fontSize: 14 }}>
                {escalatedCount} escalated session{escalatedCount === 1 ? " is" : "s are"} waiting on a human
              </Text>
              <Text color="secondary60" marginTop="xxSmall" marginBottom="none" style={{ fontSize: 12.5 }}>
                Buyers have been told we&apos;re checking — nothing was submitted.
                {waited ? ` Oldest has waited ${waited}.` : ""}
              </Text>
            </Box>
            <Text color="danger" marginBottom="none" aria-hidden="true" style={{ marginLeft: "auto", fontSize: 18 }}>
              →
            </Text>
          </Link>
        </Box>
      )}

      <Grid
        gridColumns={{ mobile: "repeat(2, 1fr)", tablet: "repeat(3, 1fr)", desktop: "repeat(6, 1fr)" }}
        marginBottom="large"
      >
        <Stat label="Received" value={metrics.received} note="POs this month" hint="POs received this calendar month" />
        <Stat label="Orders" value={metrics.orders} note="pay on account" hint="Orders placed this month" />
        <Stat label="Quotes" value={metrics.quotes} note="checkout link sent" hint="Quotes created this month" />
        <Stat
          label="Escalations"
          value={metrics.escalations}
          note={`${escalatedCount} still open`}
          tone="bad"
          hint="Sessions sent to human review this month"
        />
        <Stat
          label="Touchless"
          value={`${Math.round(metrics.touchlessRate * 100)}%`}
          note="no human needed"
          tone="ok"
          hint="Share completed without human review"
        />
        <Stat
          label="Value"
          value={`$${metrics.valueProcessed.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          note="orders placed"
          hint="Total order value placed this month (USD)"
        />
      </Grid>

      <Grid gridColumns={{ mobile: "1fr", desktop: "1.2fr 1fr" }} gridGap="16px">
        <Panel header="Recent sessions">
          {recent.length ? (
            recent.map((s) => (
              <SessionRow
                key={s.id}
                href={`${INBOX}/${encodeURIComponent(s.id)}`}
                company={s.buyer?.companyName || "(unknown sender)"}
                sub={`${s.buyer?.email ?? "unknown"} · ${poOf(s)} · ${shortWhen(s.updatedAt, nowMs)}`}
                state={s.state}
                stateLabel={stateLabel(s.state)}
              />
            ))
          ) : (
            <EmptyState title="No sessions yet">Processed POs appear here as they arrive.</EmptyState>
          )}
          <Box marginTop="medium">
            <Link href="/staff/sessions">
              <Button variant="subtle">All sessions →</Button>
            </Link>
          </Box>
        </Panel>

        <Panel header="Setup & health">
          {health.map((h) => (
            <HealthRow key={h.name} ok={h.ok} warn={h.warn} name={h.name} detail={h.detail} action={h.action} />
          ))}
        </Panel>
      </Grid>
    </>
  );
}
