import type { StoreContext } from "./store-context";
import type { QuoteConfig } from "./quote-gate";

export type { QuoteConfig } from "./quote-gate";

// Quote feature settings from B2B Edition's control panel:
//   GET https://api-b2b.bigcommerce.com/api/v2/rfq/configs?storeHash={hash}
// Shape is defensive: the payload may be an object of keys or an array of {key,value}.
// Open question (per plan §15 Q8): how per-channel quote config surfaces under MSF —
// verify at [L1] and thread the resolved channel if needed.

const FALLBACK: QuoteConfig = {
  featureEnabled: true,
  allowGuest: false, // guests closed by default (matches accelerator)
  allowIndividual: true,
  allowCompany: true,
  onProductPage: true,
  onCartPage: true,
  defaultExpirationDays: 30,
};

type RawConfig =
  | Record<string, unknown>
  | Array<{ key?: string; value?: unknown; isEnable?: unknown; isEnabled?: unknown }>;

function toBool(v: unknown, def: boolean): boolean {
  if (v == null) return def;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function readKeyMap(raw: RawConfig): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const m: Record<string, unknown> = {};
    for (const row of raw) {
      if (row && typeof row.key === "string") {
        m[row.key] = row.value ?? row.isEnabled ?? row.isEnable;
      }
    }
    return m;
  }
  return raw ?? {};
}

export function mapQuoteConfig(raw: RawConfig): QuoteConfig {
  const m = readKeyMap(raw);
  const pick = (key: string, def: boolean) => (key in m ? toBool(m[key], def) : def);
  const days = Number(m["defaultExpirationDate"] ?? m["defaultExpirationDays"]);
  return {
    featureEnabled: pick("quote_customer", FALLBACK.featureEnabled),
    allowGuest: pick("quote_for_guest", FALLBACK.allowGuest),
    allowIndividual: pick("quote_for_individual_customer", FALLBACK.allowIndividual),
    allowCompany: pick("quote_for_b2b", FALLBACK.allowCompany),
    onProductPage: pick("quote_on_product_page", FALLBACK.onProductPage),
    onCartPage: pick("quote_on_cart_page", FALLBACK.onCartPage),
    defaultExpirationDays: Number.isFinite(days) && days > 0 ? days : FALLBACK.defaultExpirationDays,
  };
}

export async function getQuoteConfigs(ctx: StoreContext): Promise<QuoteConfig> {
  try {
    const res = await fetch(
      `https://api-b2b.bigcommerce.com/api/v2/rfq/configs?storeHash=${ctx.storeHash}`,
      { headers: { "Content-Type": "application/json" }, cache: "no-store" },
    );
    if (!res.ok) return FALLBACK;
    const json = (await res.json()) as { data?: RawConfig } | RawConfig;
    const data = (json && typeof json === "object" && "data" in json ? json.data : json) as RawConfig;
    return mapQuoteConfig(data);
  } catch {
    return FALLBACK;
  }
}

export function getQuoteExpiryDays(config: QuoteConfig): number {
  return config.defaultExpirationDays > 0 ? config.defaultExpirationDays : 30;
}
