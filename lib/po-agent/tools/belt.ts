import { tool } from "ai";
import { z } from "zod";
import type { StoreContext } from "@/lib/bc/store-context";
import { getUserByEmail } from "@/lib/bc/users";
import { resolveSkusToIds } from "@/lib/bc/sku-resolver";
import { getProductPrices } from "@/lib/bc/pricing";

// Read-only AI-SDK tool belt for the optional agentic re-check pass (used only when the
// deterministic pipeline can't settle an ambiguity, e.g. a description with no SKU).
// WRITE actions (submit order/quote, send reply) are NEVER model-invoked — the state
// machine calls those deterministically.

export interface ToolScope {
  customerId?: number;
  customerGroupId?: number;
  channelId?: number;
}

export function createToolBelt(ctx: StoreContext, scope: ToolScope = {}) {
  return {
    lookup_user_by_email: tool({
      description: "Look up a B2B user (buyer) by their email address.",
      inputSchema: z.object({ email: z.string() }),
      execute: async ({ email }) => {
        const user = await getUserByEmail(ctx, email);
        return user ?? { found: false };
      },
    }),
    resolve_skus: tool({
      description: "Resolve a list of SKUs to their product and variant ids.",
      inputSchema: z.object({ skus: z.array(z.string()) }),
      execute: async ({ skus }) => Object.fromEntries(await resolveSkusToIds(ctx, skus)),
    }),
    get_customer_pricing: tool({
      description: "Get the customer-specific price for products (channel/customer-group aware).",
      inputSchema: z.object({
        items: z.array(z.object({ productId: z.number(), variantId: z.number().optional() })),
      }),
      execute: async ({ items }) =>
        Object.fromEntries(
          await getProductPrices(ctx, {
            items: items.map((i) => ({ productId: i.productId, variantId: i.variantId })),
            customerId: scope.customerId,
            customerGroupId: scope.customerGroupId,
            channelId: scope.channelId,
          }),
        ),
    }),
  };
}
