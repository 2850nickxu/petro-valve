import Link from "next/link";
import { Box, Button, Flex, Grid, Panel, Small, Text } from "@bigcommerce/big-design";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { currentYyyymm } from "@/lib/po-agent/metrics";
import { parseTokenUsage, usageTotals, type ModelUsage } from "@/lib/po-agent/token-usage";
import { PageHead, Stat } from "../ui";
import { Banner, EmptyState } from "@/components/ui/states";

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
    <Box style={{ maxWidth: 860 }}>
      <PageHead
        title="Token usage"
        sub={`AI model consumption for ${formatYm(ym)} · costs are estimates from list prices`}
      />

      {!redis && (
        <Box marginBottom="medium">
          <Banner kind="warn" title="Redis not configured">
            Token usage is recorded in Redis — the figures below read 0 until it&apos;s connected.
          </Banner>
        </Box>
      )}

      <Flex flexWrap="wrap" marginBottom="large" style={{ gap: 8 }}>
        {months.map((m) => (
          <Link key={m} href={`/staff/usage?month=${m}`}>
            <Button type="button" variant={m === ym ? "secondary" : "subtle"} aria-pressed={m === ym}>
              {formatYm(m)}
            </Button>
          </Link>
        ))}
      </Flex>

      <Grid
        gridColumns={{ mobile: "repeat(2, 1fr)", tablet: "repeat(3, 1fr)", desktop: "repeat(5, 1fr)" }}
        marginBottom="large"
      >
        <Stat label="Calls" value={totals.calls.toLocaleString()} compact />
        <Stat label="Input tokens" value={compact(totals.input)} compact hint={`${totals.input.toLocaleString()} tokens`} />
        <Stat label="Output tokens" value={compact(totals.output)} compact hint={`${totals.output.toLocaleString()} tokens`} />
        <Stat label="Total tokens" value={compact(totals.total)} compact hint={`${totals.total.toLocaleString()} tokens`} />
        <Stat label="Est. cost" value={`${totals.costKnown ? "" : "~"}${money(totals.costUsd)}`} compact />
      </Grid>

      <Panel>
        {rows.length ? (
          <Box>
            {rows.map((r) => (
              <Flex
                key={r.model}
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                paddingVertical="small"
                style={{ gap: 10 }}
              >
                <Box style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <Text bold marginBottom="none" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.model}
                  </Text>
                  <Small color="secondary60" marginBottom="none" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.calls.toLocaleString()} calls · {compact(r.input)} in · {compact(r.output)} out
                  </Small>
                </Box>
                <Text bold marginBottom="none" style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>
                  {r.costUsd != null ? money(r.costUsd) : "—"}
                </Text>
              </Flex>
            ))}
          </Box>
        ) : (
          <EmptyState title={`No AI usage recorded for ${formatYm(ym)}`}>
            Set a model + API key in <Link href="/staff/settings">Settings → AI model</Link> to use an LLM.
          </EmptyState>
        )}
        <Box marginTop="medium">
          <Small color="secondary60">
            The heuristic extractor uses no tokens — an LLM is optional but much better on messy PDFs. Cost estimates
            use a built-in per-model price table (USD per 1M tokens); verify against your provider&apos;s billing.
          </Small>
        </Box>
      </Panel>
    </Box>
  );
}
