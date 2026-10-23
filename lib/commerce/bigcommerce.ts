// BigCommerce B2B Edition behind the commerce seam: a thin wrapper over the existing lib/bc
// calls, so the rules flow behaves exactly as it did when it called them directly.

import type { StoreContext } from "@/lib/bc/store-context";
import type { PoAgentConfig } from "@/lib/po-agent/config";
import { identify } from "@/lib/po-agent/core/identify";
import { resolveChannel } from "@/lib/po-agent/core/channel";
import { submitQuote } from "@/lib/po-agent/core/submit-quote";
import { evaluate, evaluateCatalog } from "@/lib/po-agent/pipeline";
import type { CommerceAdapter } from "./types";

export function bigcommerceAdapter(ctx: StoreContext, config: PoAgentConfig): CommerceAdapter {
  return {
    platform: "bigcommerce",
    label: "BigCommerce",
    identifiesCustomers: true,

    async identify(email, { mailbox }) {
      const idres = await identify(ctx, email);
      const { channelId } = resolveChannel({ channelMap: config.channelMap, fallbackChannelId: ctx.channelId, mailbox, buyer: idres.buyer });
      return { idres, channelId };
    },

    async evaluate(extracted, { idres, channelId }) {
      const buyer = idres.buyer;
      if (!buyer) {
        const resolved = await evaluateCatalog({ ctx, config }, { extracted, channelId });
        return { resolved, issues: [], pricedFor: "guest pricing" };
      }
      const ev = await evaluate(
        { ctx, config },
        { idres, channelId, channelAmbiguous: false, channelAccessDenied: false, extracted, clarificationRounds: 0 },
      );
      return {
        resolved: ev.resolved,
        issues: ev.issues,
        defaultShipTo: ev.defaultShipTo,
        pricedFor: `${buyer.companyName || `company #${buyer.companyId}`}'s account pricing`,
      };
    },

    async createQuote({ who, email, resolved, poNumber, expiryDays, sandbox }) {
      const buyer = who.idres.buyer ?? undefined;
      return submitQuote(ctx, {
        buyer,
        guest: buyer ? undefined : { email },
        channelId: who.channelId,
        resolvedLines: resolved,
        poNumber,
        expiryDays,
        sandbox,
      });
    },
  };
}
