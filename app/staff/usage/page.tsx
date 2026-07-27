import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { currentYyyymm } from "@/lib/po-agent/metrics";
import { parseTokenUsage, usageTotals, type ModelUsage } from "@/lib/po-agent/token-usage";
import { Stat } from "../ui";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString();
const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default async function UsagePage() {
  const ym = currentYyyymm(new Date().toISOString());
  const redis = getRedis();
  let rows: ModelUsage[] = [];
  if (redis) rows = parseTokenUsage(await createPoStore(redis).getTokenUsage(ym));
  const totals = usageTotals(rows);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Token usage</h1>
          <p className="muted">AI model consumption this month ({ym}). Costs are estimates.</p>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Calls" value={fmt(totals.calls)} />
        <Stat label="Input" value={fmt(totals.input)} />
        <Stat label="Output" value={fmt(totals.output)} />
        <Stat label="Total tokens" value={fmt(totals.total)} />
        <Stat label="Est. cost" value={`${totals.costKnown ? "" : "~"}${money(totals.costUsd)}`} />
      </div>

      <div className="card">
        <h3>By model</h3>
        {rows.length ? (
          <table className="table">
            <thead>
              <tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Total</th><th>Est. cost</th></tr>
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
            No AI usage recorded this month. The heuristic extractor uses no tokens — set a model + API key in{" "}
            <a href="/staff/settings">Settings → AI</a> to use an LLM.
          </p>
        )}
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Cost estimates use a built-in per-model price table (USD per 1M tokens) and are approximate — verify against your provider’s billing.
      </p>
    </>
  );
}
