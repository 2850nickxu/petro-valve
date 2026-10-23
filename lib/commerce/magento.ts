// Magento 2 (Petro Valve) behind the commerce seam. Phase 1 has no customer lookup: known and
// guest buyers get the same web pricing and the same reply, so every sender is a guest. Lines
// are matched with lib/magento's SKU normalization; a "quote" is a guest cart plus a signed
// cart link (lib/magento/cart-link.ts).

import { buildGuestCart, CartPreflightError } from "@/lib/magento/carts";
import { signCartLink, type CartLinkConfig } from "@/lib/magento/cart-link";
import type { MagentoContext } from "@/lib/magento/magento-context";
import { resolveSkus } from "@/lib/magento/sku-resolver";
import type { MagentoProduct, SkuResolution } from "@/lib/magento/types";
import type { PoAgentConfig } from "@/lib/po-agent/config";
import { money } from "@/lib/po-agent/ai/respond";
import { submittableLines } from "@/lib/po-agent/core/resolve";
import type { PoLineItem, ResolvedLine, ValidationIssueKind } from "@/lib/po-agent/types";
import type { CommerceAdapter } from "./types";

const GUEST = { buyer: null, company: null, companyApproved: false, issues: [] };

/** A product's descriptive name: variant names just repeat the SKU, the short description doesn't. */
function displayName(p: MagentoProduct): string {
  return p.attributes?.short_description?.trim() || p.name;
}

/** One PO line as the rules engine reads it, from the Magento resolution of its SKU. */
export function toResolvedLine(line: PoLineItem, res: SkuResolution | undefined, tolerancePct: number): ResolvedLine {
  const issues: ValidationIssueKind[] = [];
  if (line.quantity == null) issues.push("missing_quantity");
  if (!line.sku || !res || res.status === "unresolved") {
    return { line, issues: ["line_unresolved", ...issues] };
  }
  if (res.status === "ambiguous") {
    return {
      line,
      issues: ["line_unresolved", ...issues],
      matchKind: "ambiguous",
      candidates: res.candidates.map((c) => ({ sku: c.sku, name: displayName(c), unitPrice: c.priceAnomaly ? undefined : c.price })),
    };
  }

  const p = res.product;
  const base: ResolvedLine = {
    line,
    productId: p.id,
    matchedSku: p.sku,
    productName: displayName(p),
    available: p.enabled,
    inventoryTracked: false,
    inventoryLevel: null,
    issues,
    ...(res.exact ? {} : { matchKind: "recommended" as const }),
  };

  if (res.status === "parent") {
    return {
      ...base,
      parentSku: true,
      variantChoices: res.children.map((c) => ({
        variantId: c.id,
        sku: c.sku,
        ...(c.priceAnomaly ? {} : { unitPrice: c.price }),
      })),
      variantChoiceCount: res.childCount,
      issues: ["line_parent_sku", ...issues],
    };
  }

  // Disabled → not sellable (P10). A $0.01 placeholder is no price at all (Q5): it must never
  // reach a quote, so the line carries no unit price.
  if (!p.enabled) issues.push("line_unresolved");
  if (p.priceAnomaly) return { ...base, issues: [...issues, "line_unpriced"] };

  const stated = line.statedUnitPrice;
  if (stated != null && p.price > 0 && (Math.abs(stated - p.price) / p.price) * 100 > tolerancePct) issues.push("price_mismatch");
  return { ...base, calculatedUnitPrice: p.price, issues };
}

export function magentoAdapter(
  ctx: MagentoContext,
  opts: { config: PoAgentConfig; cartLink: CartLinkConfig | null; now?: () => number },
): CommerceAdapter {
  return {
    platform: "magento",
    label: "Magento",
    identifiesCustomers: false,

    async identify() {
      return { idres: GUEST, channelId: 1 };
    },

    async evaluate(extracted) {
      const skus = extracted.lines.map((l) => l.sku).filter((s): s is string => Boolean(s?.trim()));
      // Attributes carry the short description, the only readable product name on a variant.
      const found = skus.length ? await resolveSkus(ctx, skus, { withAttributes: true }) : new Map<string, SkuResolution>();
      const resolved = extracted.lines.map((line) =>
        toResolvedLine(line, line.sku ? found.get(line.sku.trim()) : undefined, opts.config.priceTolerancePct),
      );
      return { resolved, issues: [], pricedFor: "web pricing (every sender is quoted as a guest)" };
    },

    async createQuote({ resolved }) {
      const lines = submittableLines(resolved)
        .filter((r) => r.calculatedUnitPrice != null && r.matchedSku)
        .map((r) => ({ sku: r.matchedSku!, qty: r.line.quantity ?? 1 }));
      if (!lines.length) return { ok: false, reason: "no_quotable_lines" };
      try {
        const cart = await buildGuestCart(ctx, lines);
        // The reply quotes catalog prices; never send a cart that charges something else.
        if (cart.excludedItems.length) {
          return { ok: false, reason: `cart_excluded_items: Magento won't charge ${cart.excludedItems.map((i) => i.sku).join(", ")}` };
        }
        if (cart.priceMismatches.length) {
          const diffs = cart.priceMismatches.map((m) => `${m.sku} catalog ${money(m.catalogPrice)} vs cart ${money(m.cartPrice)}`);
          return { ok: false, reason: `cart_price_mismatch: ${diffs.join("; ")}` };
        }
        return {
          ok: true,
          quoteId: cart.maskedId,
          ...(opts.cartLink ? { checkoutUrl: signCartLink(opts.cartLink, cart.maskedId, opts.now?.()) } : {}),
        };
      } catch (err) {
        if (err instanceof CartPreflightError) return { ok: false, reason: err.message };
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
