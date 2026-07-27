// Token-usage aggregation + a best-effort cost estimate per model. Usage is recorded in
// Redis (poa:tokens:{yyyymm}) as HINCRBY fields "{model}|in", "{model}|out", "{model}|calls".

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  total: number;
  calls: number;
  costUsd?: number;
}

// USD per 1M tokens — ESTIMATES for display only (matched by substring; edit as prices
// change). Unknown models show tokens without a cost.
export const MODEL_PRICES: Array<{ match: string; in: number; out: number }> = [
  { match: "claude-opus", in: 15, out: 75 },
  { match: "claude-sonnet", in: 3, out: 15 },
  { match: "claude-haiku", in: 1, out: 5 },
  { match: "gpt-5", in: 1.25, out: 10 },
  { match: "gpt-4.1", in: 2, out: 8 },
  { match: "gpt-4o", in: 2.5, out: 10 },
  { match: "o4-mini", in: 1.1, out: 4.4 },
  { match: "gemini-2.5-pro", in: 1.25, out: 10 },
  { match: "gemini-2.5-flash", in: 0.3, out: 2.5 },
  { match: "gemini-2.0-flash", in: 0.1, out: 0.4 },
];

export function estimateCostUsd(model: string, input: number, output: number): number | undefined {
  const p = MODEL_PRICES.find((x) => model.includes(x.match));
  if (!p) return undefined;
  return (input / 1_000_000) * p.in + (output / 1_000_000) * p.out;
}

/** Parse a poa:tokens:{ym} hash into per-model usage rows (sorted by total desc). */
export function parseTokenUsage(flat: Record<string, number>): ModelUsage[] {
  const byModel: Record<string, { input: number; output: number; calls: number }> = {};
  for (const [key, value] of Object.entries(flat)) {
    const i = key.lastIndexOf("|");
    if (i < 0) continue;
    const model = key.slice(0, i);
    const metric = key.slice(i + 1);
    const row = (byModel[model] ??= { input: 0, output: 0, calls: 0 });
    if (metric === "in") row.input = value;
    else if (metric === "out") row.output = value;
    else if (metric === "calls") row.calls = value;
  }
  return Object.entries(byModel)
    .map(([model, u]) => ({
      model,
      input: u.input,
      output: u.output,
      total: u.input + u.output,
      calls: u.calls,
      costUsd: estimateCostUsd(model, u.input, u.output),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface UsageTotals {
  input: number;
  output: number;
  total: number;
  calls: number;
  costUsd: number;
  costKnown: boolean;
}

export function usageTotals(rows: ModelUsage[]): UsageTotals {
  let input = 0, output = 0, calls = 0, costUsd = 0, costKnown = true;
  for (const r of rows) {
    input += r.input;
    output += r.output;
    calls += r.calls;
    if (r.costUsd == null) costKnown = false;
    else costUsd += r.costUsd;
  }
  return { input, output, total: input + output, calls, costUsd, costKnown };
}
