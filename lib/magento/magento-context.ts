// MagentoContext — the Magento counterpart of StoreContext (lib/bc/store-context.ts).
// Everything in lib/magento takes a MagentoContext; nothing else reads process.env.MAGENTO_*.
// Phase 1 (Petro Valve) points at the PRODUCTION store. The client in ./client.ts issues GETs,
// the admin-token login, and — only when `guestCartWrites` is on — two guest-cart writes
// (create a guest cart, add an item to it). Nothing else may write to the store.

export interface MagentoContext {
  /** Store origin, e.g. https://petrovalve.com (REST lives under /rest/V1). */
  baseUrl: string;
  /** Admin user for POST /V1/integration/admin/token (bearer token, ~4h lifetime). */
  username: string;
  password: string;
  /** MAGENTO_GUEST_CART_WRITES=true. Off by default: guest-cart writes throw without it. */
  guestCartWrites?: boolean;
}

/**
 * Resolve the MagentoContext from environment. Throws when the store is not configured so
 * callers fail loudly rather than silently hitting the wrong store.
 */
export function getMagentoContext(env: Record<string, string | undefined> = process.env): MagentoContext {
  const baseUrl = env.MAGENTO_BASE_URL?.trim();
  const username = env.MAGENTO_ADMIN_USERNAME?.trim();
  const password = env.MAGENTO_ADMIN_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error(
      "Magento store context not configured: set MAGENTO_BASE_URL, MAGENTO_ADMIN_USERNAME and MAGENTO_ADMIN_PASSWORD.",
    );
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("MAGENTO_BASE_URL must be an https:// origin.");
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    username,
    password,
    guestCartWrites: env.MAGENTO_GUEST_CART_WRITES?.trim().toLowerCase() === "true",
  };
}

/** Non-throwing variant: returns null when the store context is not configured. */
export function tryGetMagentoContext(env: Record<string, string | undefined> = process.env): MagentoContext | null {
  try {
    return getMagentoContext(env);
  } catch {
    return null;
  }
}
