// StoreContext — the single seam that keeps every BigCommerce call session-less and
// swappable. Phase A resolves it from env; Phase B (standalone BigCommerce app) will
// resolve it per-store from OAuth token storage keyed by store hash. NOTHING in the
// lib/bc layer reads process.env.BIGCOMMERCE_* directly — it all takes a StoreContext.

export interface StoreContext {
  /** BigCommerce store hash (the `{hash}` in api.bigcommerce.com/stores/{hash}). */
  storeHash: string;
  /**
   * The single store access token. B2B Edition uses the SAME token (X-Auth-Token)
   * with its B2B scope set to `modify` — there is no separate B2B token.
   */
  accessToken: string;
  /** Sales channel id. Store-specific; "1" is only the default channel. */
  channelId: number;
  /** Optional: official Storefront MCP endpoint to mount alongside in-process tools. */
  storefrontMcpUrl?: string;
}

/**
 * Resolve the StoreContext from environment (Phase A). Throws when the store is not
 * configured so callers fail loudly rather than silently hitting the wrong store.
 */
export function getStoreContext(env: Record<string, string | undefined> = process.env): StoreContext {
  const storeHash = env.BIGCOMMERCE_STORE_HASH;
  const accessToken = env.BIGCOMMERCE_ACCESS_TOKEN;
  if (!storeHash || !accessToken) {
    throw new Error(
      "BigCommerce store context not configured: set BIGCOMMERCE_STORE_HASH and BIGCOMMERCE_ACCESS_TOKEN.",
    );
  }
  return {
    storeHash,
    accessToken,
    channelId: parseInt(env.BIGCOMMERCE_CHANNEL_ID ?? "1", 10),
    storefrontMcpUrl: env.BIGCOMMERCE_STOREFRONT_MCP_URL || undefined,
  };
}

/** Non-throwing variant: returns null when the store context is not configured. */
export function tryGetStoreContext(env: Record<string, string | undefined> = process.env): StoreContext | null {
  try {
    return getStoreContext(env);
  } catch {
    return null;
  }
}
