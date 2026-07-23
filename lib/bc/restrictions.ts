import { bcFetchData } from "./bc-client";
import type { StoreContext } from "./store-context";
import type { B2BCompany } from "./types";

// Catalog assortment restrictions — feature-flagged, OFF by default. When enabled
// (CATALOG_RESTRICTIONS=assortments), a company sees only products tagged with one of
// its assortment codes (a closed model: untagged products are hidden from restricted
// companies). Entitlement resolution is PURE (given the company); the product→codes
// resolver is injectable so the pipeline can supply metafield-backed lookups and tests
// can stub them.

type Env = Record<string, string | undefined>;

export type Entitlements = { mode: "all" } | { mode: "assortments"; codes: string[] };

export function catalogRestrictionsEnabled(env: Env = process.env): boolean {
  return env.CATALOG_RESTRICTIONS === "assortments";
}

export function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

/** Parse a code list: JSON array, comma/space separated, or the "all" sentinel. */
export function parseCodeList(raw: string | undefined | null): string[] | "all" | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "all") return "all";
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((c) => normalizeCode(String(c)));
  } catch {
    /* not JSON — fall through */
  }
  return trimmed
    .split(/[,\s]+/)
    .map((c) => normalizeCode(c))
    .filter(Boolean);
}

function defaultEntitlements(env: Env): Entitlements {
  return env.CATALOG_RESTRICTIONS_DEFAULT === "none" ? { mode: "assortments", codes: [] } : { mode: "all" };
}

/** Resolve a company's entitlements from its "Assortment Codes" extra field. Pure. */
export function resolveEntitlements(company: B2BCompany | null, env: Env = process.env): Entitlements {
  if (!catalogRestrictionsEnabled(env)) return { mode: "all" };
  const field = company?.extraFields?.find((f) => normalizeCode(f.fieldName) === "assortment codes");
  const codes = parseCodeList(field?.fieldValue);
  if (codes === "all") return { mode: "all" };
  if (!codes || codes.length === 0) return defaultEntitlements(env);
  return { mode: "assortments", codes };
}

/** Pure predicate: is a product (with these assortment codes) visible under entitlements? */
export function isProductVisible(productCodes: string[], ent: Entitlements): boolean {
  if (ent.mode === "all") return true;
  if (!productCodes.length) return false; // untagged ⇒ hidden from restricted companies
  const set = new Set(ent.codes);
  return productCodes.some((c) => set.has(normalizeCode(c)));
}

export type ProductCodeResolver = (productId: number) => Promise<string[]>;

/** Return the subset of productIds that the entitlements block. */
export async function findBlockedProductIds(
  ent: Entitlements,
  productIds: number[],
  getCodes: ProductCodeResolver,
): Promise<number[]> {
  if (ent.mode === "all") return [];
  const blocked: number[] = [];
  for (const id of productIds) {
    const codes = await getCodes(id).catch(() => []);
    if (!isProductVisible(codes, ent)) blocked.push(id);
  }
  return blocked;
}

/**
 * Default product→codes resolver backed by product metafields:
 *   GET /v3/catalog/products/{id}/metafields  (key "assortment_codes" in the namespace)
 */
export function metafieldCodeResolver(
  ctx: StoreContext,
  namespace = process.env.BC_METAFIELD_NAMESPACE ?? "acme_b2b",
): ProductCodeResolver {
  return async (productId: number) => {
    const metafields = await bcFetchData<Array<{ key: string; value: string; namespace: string }>>(
      ctx,
      `/v3/catalog/products/${productId}/metafields?limit=250`,
    ).catch(() => []);
    const field = metafields.find(
      (m) => m.namespace === namespace && (m.key === "assortment_codes" || m.key === "assortment"),
    );
    const parsed = parseCodeList(field?.value);
    return parsed === "all" || parsed == null ? [] : parsed;
  };
}
