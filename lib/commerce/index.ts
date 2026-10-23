// Pick the commerce adapter for this deployment from config (PO_AGENT_COMMERCE).

import type { StoreContext } from "@/lib/bc/store-context";
import { cartLinkConfig } from "@/lib/magento/cart-link";
import { tryGetMagentoContext } from "@/lib/magento/magento-context";
import type { CommercePlatform, PoAgentConfig } from "@/lib/po-agent/config";
import { bigcommerceAdapter } from "./bigcommerce";
import { magentoAdapter } from "./magento";
import type { CommerceAdapter } from "./types";

export type { CommerceAdapter, CommercePlatform };

type Env = Record<string, string | undefined>;

export const PLATFORM_LABEL: Record<CommercePlatform, string> = {
  bigcommerce: "BigCommerce",
  magento: "Magento",
};

/**
 * The adapter for `config.commerce`, or why there isn't one. The BigCommerce store context is
 * request-scoped (an installed app's OAuth token), so the caller resolves and passes it.
 */
export function resolveCommerce(
  config: PoAgentConfig,
  env: Env,
  bcCtx: StoreContext | null,
): { adapter: CommerceAdapter } | { error: string } {
  if (config.commerce === "magento") {
    const ctx = tryGetMagentoContext(env);
    if (!ctx) return { error: "Connect the Magento store in Settings → Store to run the simulator." };
    return { adapter: magentoAdapter(ctx, { config, cartLink: cartLinkConfig(env, ctx.baseUrl) }) };
  }
  if (!bcCtx) return { error: "Connect a BigCommerce store in Settings to run the simulator." };
  return { adapter: bigcommerceAdapter(bcCtx, config) };
}
