// Metrics derived from the poa:counters:{yyyymm} hash.

export interface Metrics {
  received: number;
  orders: number;
  quotes: number;
  escalations: number;
  touchless: number;
  /** Share of processed POs completed without human intervention. */
  touchlessRate: number;
  valueProcessed: number;
}

export function computeMetrics(counters: Record<string, number>): Metrics {
  const received = counters.received ?? 0;
  const orders = counters.orders ?? 0;
  const quotes = counters.quotes ?? 0;
  const escalations = counters.escalations ?? 0;
  const touchless = orders + quotes;
  const denom = touchless + escalations;
  return {
    received,
    orders,
    quotes,
    escalations,
    touchless,
    touchlessRate: denom > 0 ? touchless / denom : 0,
    valueProcessed: (counters.valueCents ?? 0) / 100,
  };
}

export function currentYyyymm(nowIso: string): string {
  return `${nowIso.slice(0, 4)}${nowIso.slice(5, 7)}`;
}
