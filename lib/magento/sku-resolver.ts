// Resolve buyer-written SKUs to Magento products — the Magento counterpart of
// lib/bc/sku-resolver.ts. All candidates for all inputs go out in one batched `sku in (...)`
// search; configurable parents then fetch their children so the agent can ask which size.
// The resolver reports facts (exact vs. prefix-added, disabled, price anomaly); deciding
// whether to quote, clarify or escalate belongs to the rules layer.

import { getConfigurableChildren, getProductsBySkus, type LookupOptions } from "./catalog";
import type { MagentoContext } from "./magento-context";
import { isExactCandidate, skuCandidates } from "./sku";
import type { MagentoProduct, SkuResolution } from "./types";

/** Children returned per parent (the true count is kept in `childCount`). */
export const MAX_CHILD_CHOICES = 25;

export async function resolveSkus(
  ctx: MagentoContext,
  inputs: string[],
  opts: LookupOptions = {},
): Promise<Map<string, SkuResolution>> {
  const result = new Map<string, SkuResolution>();
  const clean = [...new Set(inputs.map((s) => s.trim()).filter(Boolean))];
  if (!clean.length) return result;

  const candidatesOf = new Map(clean.map((input) => [input, skuCandidates(input)]));
  const found = await getProductsBySkus(ctx, [...candidatesOf.values()].flat(), opts);

  await Promise.all(
    clean.map(async (input) => {
      const hits = candidatesOf
        .get(input)!
        .filter((c) => found.has(c))
        .map((c) => ({ product: found.get(c)!, exact: isExactCandidate(input, c) }));
      const exactHit = hits.find((h) => h.exact);
      const pick = exactHit ?? (hits.length === 1 ? hits[0] : undefined);

      if (!pick) {
        result.set(
          input,
          hits.length
            ? { status: "ambiguous", input, candidates: hits.map((h) => h.product) }
            : { status: "unresolved", input },
        );
        return;
      }
      if (pick.product.typeId === "configurable") {
        const children: MagentoProduct[] = await getConfigurableChildren(ctx, pick.product.sku, opts);
        result.set(input, {
          status: "parent",
          input,
          product: pick.product,
          children: children.slice(0, MAX_CHILD_CHOICES),
          childCount: children.length,
          exact: pick.exact,
        });
        return;
      }
      result.set(input, { status: "matched", input, product: pick.product, exact: pick.exact });
    }),
  );
  return result;
}
