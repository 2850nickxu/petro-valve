import type { StoreContext } from "@/lib/bc/store-context";
import { getProductPrices, priceKey } from "@/lib/bc/pricing";
import type { ResolvedLine } from "../types";

// Apply customer-specific pricing (POST /v3/pricing/products) to resolved lines. The
// store-calculated price ALWAYS wins; the PO's stated price only drives a tolerance check
// (|Δ| > tolerance% ⇒ price_mismatch clarification).

export interface PriceOptions {
  customerId?: number;
  customerGroupId?: number;
  channelId?: number;
  tolerancePct: number;
  currencyCode?: string;
}

export async function priceLines(
  ctx: StoreContext,
  resolved: ResolvedLine[],
  opts: PriceOptions,
): Promise<ResolvedLine[]> {
  const items = resolved
    .filter((r) => r.productId != null)
    .map((r) => ({ productId: r.productId!, variantId: r.variantId }));
  if (!items.length) return resolved;

  const prices = await getProductPrices(ctx, {
    items,
    customerId: opts.customerId,
    customerGroupId: opts.customerGroupId,
    channelId: opts.channelId,
    currencyCode: opts.currencyCode,
  });

  return resolved.map((r) => {
    if (r.productId == null) return r;
    const priced = prices.get(priceKey(r.productId, r.variantId));
    if (!priced) return r;

    const calc = priced.unitPrice;
    const issues = [...r.issues];
    const stated = r.line.statedUnitPrice;
    if (stated != null && calc > 0) {
      const diffPct = (Math.abs(stated - calc) / calc) * 100;
      if (diffPct > opts.tolerancePct && !issues.includes("price_mismatch")) {
        issues.push("price_mismatch");
      }
    }
    return { ...r, calculatedUnitPrice: calc, issues };
  });
}

/** Estimated pre-shipping/tax subtotal from resolved+priced lines (for the credit check). */
export function estimatedSubtotal(resolved: ResolvedLine[]): number {
  return resolved.reduce((sum, r) => {
    if (r.productId == null || r.blockedByAssortment) return sum;
    const unit = r.calculatedUnitPrice ?? 0;
    const qty = r.line.quantity ?? 0;
    return sum + unit * qty;
  }, 0);
}
