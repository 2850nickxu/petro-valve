// Single currency formatter — dedupes the ad-hoc `$${n.toFixed(2)}` closures scattered
// across the session/simulator views. Server-safe (no hooks).

export function formatMoney(n?: number | null, currency?: string | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const code = currency && currency.trim() ? currency.trim().toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function Money({ value, currency }: { value?: number | null; currency?: string | null }) {
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(value, currency)}</span>;
}
