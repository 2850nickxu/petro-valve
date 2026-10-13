import Link from "next/link";
import { Panel, KpiRow } from "@/components/backbone";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { currentYyyymm } from "@/lib/po-agent/metrics";
import { parseTokenUsage, usageTotals, type ModelUsage } from "@/lib/po-agent/token-usage";
import { PageHead, Stat } from "../ui";
import { Banner, EmptyState } from "@/components/ui/states";
import { LinkButton } from "@/components/ui/link-button";
import { redirect } from "next/navigation";
import { currentAdminView } from "@/lib/bc-app/request-context";
import { VIEW_HOME, canSeeUsage } from "@/lib/po-agent/admin-view";

export const dynamic = "force-dynamic";

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Compact token count — 9.61M / 1.14M / 88k — matching the design's stat tiles. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return n.toLocaleString();
}

/** Return the last `count` YYYYMM strings (most recent first). */
function recentMonths(count = 4): string[] {
  const now = new Date();
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear().toString();
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    results.push(`${y}${m}`);
  }
  return results;
}

/** Format YYYYMM as "Jul 2026". */
function formatYm(ym: string): string {
  const year = parseInt(ym.slice(0, 4), 10);
  const month = parseInt(ym.slice(4, 6), 10) - 1;
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  // Token usage is Silk-only: the customer view never renders it, even by direct URL.
  if (!canSeeUsage(await currentAdminView())) redirect(VIEW_HOME.customer);

  const sp = await searchParams;
  const now = new Date().toISOString();
  const thisMonth = currentYyyymm(now);
  const months = recentMonths(4);

  // Validate the requested month — must be in our list, else fall back to the current one.
  const requested = sp.month ?? thisMonth;
  const ym = months.includes(requested) ? requested : thisMonth;

  const redis = getRedis();
  let rows: ModelUsage[] = [];
  if (redis) rows = parseTokenUsage(await createPoStore(redis).getTokenUsage(ym));
  const totals = usageTotals(rows);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-section)", maxWidth: 880 }}>
      <PageHead
        title="Token usage"
        sub={`AI model consumption for ${formatYm(ym)} · costs are estimates from list prices`}
      />

      {!redis && (
        <Banner kind="warn" title="Redis not configured">
          Token usage is recorded in Redis — the figures below read 0 until it&apos;s connected.
        </Banner>
      )}

      <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {months.map((m) => (
          <LinkButton
            key={m}
            href={`/staff/usage?month=${m}`}
            variant={m === ym ? "secondary" : "ghost"}
            size="micro"
            aria-current={m === ym ? "page" : undefined}
          >
            {formatYm(m)}
          </LinkButton>
        ))}
      </span>

      <KpiRow>
        <Stat label="Calls" value={totals.calls.toLocaleString()} />
        <Stat label="Input tokens" value={compact(totals.input)} />
        <Stat label="Output tokens" value={compact(totals.output)} />
        <Stat label="Total tokens" value={compact(totals.total)} />
        <Stat label="Est. cost" value={`${totals.costKnown ? "" : "~"}${money(totals.costUsd)}`} />
      </KpiRow>

      <Panel title="By model" padded={false}>
        {rows.length ? (
          rows.map((r) => (
            <div
              key={r.model}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                padding: "var(--space-3) var(--panel-pad)",
                borderTop: "var(--border-w) solid var(--border-subtle)",
              }}
            >
              <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: "var(--weight-medium)", fontVariantNumeric: "tabular-nums" }}>{r.model}</span>
                <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)", fontVariantNumeric: "tabular-nums" }}>
                  {r.calls.toLocaleString()} calls · {compact(r.input)} in · {compact(r.output)} out
                </span>
              </span>
              <span style={{ flex: "none", fontWeight: "var(--weight-medium)", fontVariantNumeric: "tabular-nums" }}>
                {r.costUsd != null ? money(r.costUsd) : "—"}
              </span>
            </div>
          ))
        ) : (
          <div style={{ padding: "var(--panel-pad)" }}>
            <EmptyState title={`No AI usage recorded for ${formatYm(ym)}`}>
              Set a model + API key in <Link href="/staff/settings">Settings → AI model</Link> to use an LLM.
            </EmptyState>
          </div>
        )}
      </Panel>

      <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
        The heuristic extractor uses no tokens — an LLM is optional but much better on messy PDFs. Cost estimates use a
        built-in per-model price table (USD per 1M tokens); verify against your provider&apos;s billing.
      </span>
    </div>
  );
}
