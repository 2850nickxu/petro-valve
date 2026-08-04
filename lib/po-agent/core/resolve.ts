import type { StoreContext } from "@/lib/bc/store-context";
import { resolveSkusToIds } from "@/lib/bc/sku-resolver";
import { getProductsByIds } from "@/lib/bc/catalog";
import { findBlockedProductIds, type Entitlements, type ProductCodeResolver } from "@/lib/bc/restrictions";
import type { SkuResolution } from "@/lib/bc/types";
import type { PoLineItem, ResolvedLine, ValidationIssueKind } from "../types";

// PO lines → catalog: SKU resolution, purchasability (visibility/availability/inventory/
// order-quantity bounds), and assortment blocking. Pricing is applied separately (price.ts).

export interface ResolveOptions {
  entitlements?: Entitlements;
  codeResolver?: ProductCodeResolver;
}

/**
 * Lines that can actually be ordered: resolved to a product, not blocked, not unresolved,
 * and not still sitting on a parent SKU (BC would 422 those for a missing variant id).
 */
export function submittableLines(lines: ResolvedLine[]): ResolvedLine[] {
  return lines.filter(
    (l) =>
      l.productId != null &&
      !l.blockedByAssortment &&
      !l.issues.includes("line_unresolved") &&
      !l.issues.includes("line_parent_sku"),
  );
}

export async function resolveLines(
  ctx: StoreContext,
  lines: PoLineItem[],
  opts: ResolveOptions = {},
): Promise<ResolvedLine[]> {
  const skus = lines.map((l) => l.sku).filter((s): s is string => Boolean(s));
  const skuMap: Map<string, SkuResolution> = skus.length
    ? await resolveSkusToIds(ctx, skus)
    : new Map();

  // First pass: attach ids and structural issues.
  const prelim: ResolvedLine[] = lines.map((line) => {
    const issues: ValidationIssueKind[] = [];
    let productId: number | undefined;
    let variantId: number | undefined;
    let matchedSku: string | undefined;
    let parentSku = false;
    let variantChoices: ResolvedLine["variantChoices"];
    let variantChoiceCount: number | undefined;

    if (line.sku) {
      const hit = skuMap.get(line.sku) ?? skuMap.get(line.sku.trim());
      if (hit) {
        productId = hit.productId;
        variantId = hit.variantId;
        matchedSku = line.sku;
        if (hit.isParentSku) {
          // Matched a real product, but the buyer named the parent — which child?
          parentSku = true;
          variantChoices = hit.children;
          variantChoiceCount = hit.childCount;
          issues.push("line_parent_sku");
        }
      } else {
        issues.push("line_unresolved");
      }
    } else {
      issues.push("line_unresolved"); // no SKU; fuzzy search is a v2 enhancement
    }
    if (line.quantity == null) issues.push("missing_quantity");

    return {
      line,
      productId,
      variantId,
      matchedSku,
      issues,
      ...(parentSku ? { parentSku, variantChoices, variantChoiceCount } : {}),
    };
  });

  const productIds = [...new Set(prelim.filter((p) => p.productId != null).map((p) => p.productId!))];
  const details = productIds.length ? await getProductsByIds(ctx, productIds) : new Map();

  let blocked = new Set<number>();
  if (opts.entitlements?.mode === "assortments" && opts.codeResolver && productIds.length) {
    blocked = new Set(await findBlockedProductIds(opts.entitlements, productIds, opts.codeResolver));
  }

  // Second pass: enrich with catalog detail, inventory, bounds, assortment.
  return prelim.map((p) => {
    if (p.productId == null) return p;
    const issues = [...p.issues];
    const d = details.get(p.productId);

    const blockedByAssortment = blocked.has(p.productId);
    if (blockedByAssortment) issues.push("line_blocked_by_assortment");

    let available = true;
    let inventoryTracked = false;
    let inventoryLevel: number | null = null;
    let minQty: number | undefined;
    let maxQty: number | undefined;

    if (d) {
      available = d.is_visible && d.availability !== "disabled";
      if (!available && !issues.includes("line_unresolved")) issues.push("line_unresolved");
      inventoryTracked = d.inventory_tracking !== "none";
      inventoryLevel = inventoryTracked ? d.inventory_level : null;
      minQty = d.order_quantity_minimum || undefined;
      maxQty = d.order_quantity_maximum || undefined;

      const qty = p.line.quantity;
      if (qty != null) {
        if ((minQty && qty < minQty) || (maxQty && qty > maxQty)) issues.push("line_qty_bounds");
        // Stock lives on the child variant, so a parent-SKU line has nothing to check yet.
        if (!p.parentSku && inventoryTracked && inventoryLevel != null && qty > inventoryLevel) {
          issues.push("line_inventory_short");
        }
      }
    }

    return {
      ...p,
      issues,
      productName: d?.name,
      available,
      inventoryTracked,
      inventoryLevel,
      minQty,
      maxQty,
      blockedByAssortment,
    };
  });
}
