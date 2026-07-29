import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { currentYyyymm } from "@/lib/po-agent/metrics";
import { parseTokenUsage, usageTotals, type ModelUsage } from "@/lib/po-agent/token-usage";
import { Stat } from "../ui";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString();
const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Return the last `count` YYYYMM strings (most recent first). */
function recentMonths(count = 6): string[] {
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

/** Format YYYYMM as "Jan 2026". */
function formatYm(ym: string): string {
  const year = parseInt(ym.slice(0, 4), 10);
  const month = parseInt(ym.slice(4, 6), 10) - 1;
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date().toISOString();
  const thisMonth = currentYyyymm(now);
  const months = recentMonths(6);

  // Validate the requested month — must be in our list or fall back to current
  const requested = sp.month ?? thisMonth;
  const ym = months.includes(requested) ? requested : thisMonth;

  const redis = getRedis();
  let rows: ModelUsage[] = [];
  if (redis) rows = parseTokenUsage(await createPoStore(redis).getTokenUsage(ym));
  const totals = usageTotals(rows);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Token usage</h1>
          <p className="muted">AI model consumption for {formatYm(ym)}. Costs are estimates.</p>
        </div>
      </div>

      {/* Month selector */}
      <div className="toolbar mb-2" style={{ marginBottom: 16 }}>
        {months.map((m) => (
          <a
            key={m}
            href={`/staff/usage?month=${m}`}
            className={`btn sm${m === ym ? " primary" : " secondary"}`}
            style={{ marginRight: 4 }}
          >
            {formatYm(m)}
          </a>
        ))}
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Calls" value={fmt(totals.calls)} />
        <Stat label="Input tokens" value={fmt(totals.input)} />
        <Stat label="Output tokens" value={fmt(totals.output)} />
        <Stat label="Total tokens" value={fmt(totals.total)} />
        <Stat label="Est. cost" value={`${totals.costKnown ? "" : "~"}${money(totals.costUsd)}`} />
      </div>

      <div className="card">
        <h3>By model</h3>
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Calls</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Total</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model}>
                  <td className="mono">{r.model}</td>
                  <td>{fmt(r.calls)}</td>
                  <td>{fmt(r.input)}</td>
                  <td>{fmt(r.output)}</td>
                  <td>{fmt(r.total)}</td>
                  <td>{r.costUsd != null ? money(r.costUsd) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            No AI usage recorded for {formatYm(ym)}. The heuristic extractor uses no tokens — set a model + API key in{" "}
            <a href="/staff/settings">Settings → AI</a> to use an LLM.
          </p>
        )}
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Cost estimates use a built-in per-model price table (USD per 1M tokens) and are approximate — verify against your provider&apos;s billing.
      </p>
    </>
  );
}
