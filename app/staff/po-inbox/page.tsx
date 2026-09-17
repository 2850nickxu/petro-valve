import Link from "next/link";
import { Badge, Panel } from "@/components/backbone";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { PageHead, SessionRow, stateLabel } from "../ui";
import { Banner, EmptyState } from "@/components/ui/states";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

function poOf(s: PoSession): string {
  return s.extracted?.poNumber || "no PO number";
}

function shortWhen(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sameDay = new Date(t).toDateString() === new Date(nowMs).toDateString();
  if (sameDay) return iso.slice(11, 16);
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The reason codes an operator needs to see at a glance. */
function reasonOf(s: PoSession): string {
  return s.escalation?.reasons.join(", ") || s.decision?.reasons.join(", ") || s.decision?.kind || "—";
}

export default async function PoInboxPage() {
  const redis = getRedis();
  if (!redis) {
    return (
      <>
        <PageHead title="Inbox" sub="Escalated sessions need a human decision — everything else ran touchless" />
        <Banner kind="error" title="Redis is not configured">
          The review queue is unavailable. Set <code>UPSTASH_REDIS_REST_URL</code> and{" "}
          <code>UPSTASH_REDIS_REST_TOKEN</code> in <Link href="/staff/settings">Settings</Link> to track and review PO
          sessions.
        </Banner>
      </>
    );
  }

  const store = createPoStore(redis);
  const [escalatedIds, recentIds] = await Promise.all([
    store.listQueue("escalated", 50),
    store.listQueue("recent", 25),
  ]);
  const escalated = await store.loadSessions(escalatedIds);
  const recent = await store.loadSessions(recentIds);
  const nowMs = Date.now();

  return (
    <>
      <PageHead title="Inbox" sub="Escalated sessions need a human decision — everything else ran touchless">
        <AutoRefresh />
      </PageHead>

      <div data-density="compact" style={{ display: "flex", flexDirection: "column", gap: "var(--gap-section)" }}>
        <Panel
          title="Escalated"
          padded={false}
          actions={<Badge tone={escalated.length ? "danger" : "neutral"} mono>{escalated.length}</Badge>}
        >
          {escalated.length ? (
            escalated.map((s) => (
              <SessionRow
                key={s.id}
                href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}
                company={s.buyer?.companyName || "(unknown sender)"}
                sub={`${s.buyer?.email ?? "unknown"} · ${shortWhen(s.updatedAt, nowMs)}`}
                meta={<span style={{ color: "var(--danger-600)" }}>{reasonOf(s)}</span>}
                state="escalated"
                stateLabel="escalated"
                tint="bad"
              />
            ))
          ) : (
            <div style={{ padding: "var(--panel-pad)" }}>
              <EmptyState icon="done" title="Queue is clear">No sessions are waiting for review.</EmptyState>
            </div>
          )}
        </Panel>

        <Panel title="Recent" padded={false}>
          {recent.length ? (
            recent.map((s) => (
              <SessionRow
                key={s.id}
                href={`/staff/po-inbox/${encodeURIComponent(s.id)}`}
                company={s.buyer?.companyName || "(unknown sender)"}
                sub={`${s.buyer?.email ?? "unknown"} · ${poOf(s)} · ${shortWhen(s.updatedAt, nowMs)}`}
                state={s.state}
                stateLabel={stateLabel(s.state)}
              />
            ))
          ) : (
            <div style={{ padding: "var(--panel-pad)" }}>
              <EmptyState title="No sessions yet">Processed POs will appear here as they arrive.</EmptyState>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
