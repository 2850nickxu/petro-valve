// MagentoContext — the Magento counterpart of StoreContext (lib/bc/store-context.ts).
// Everything in lib/magento takes a MagentoContext; nothing else reads process.env.MAGENTO_*.
// The client in ./client.ts issues GETs, the admin-token login, and — only when the active
// store's `guestCartWrites` is on — two guest-cart writes (create a guest cart, add an item to
// it). Nothing else may write to the store.
//
// Two stores, one switch: MAGENTO_STORE=production (default) uses MAGENTO_*; MAGENTO_STORE=sandbox
// uses MAGENTO_SANDBOX_* (Petro Valve's Epicor-hosted test site). Each store has its OWN
// guest-cart write switch, so writes turned on for the sandbox never carry over to production.
// The sandbox falls back to the production admin login when it has none of its own.

export type MagentoStore = "production" | "sandbox";

export interface MagentoContext {
  /** Which configured store this is. */
  store: MagentoStore;
  /** Store origin, e.g. https://petrovalve.com (REST lives under /rest/V1). */
  baseUrl: string;
  /** Admin user for POST /V1/integration/admin/token (bearer token, ~4h lifetime). */
  username: string;
  password: string;
  /** This store's guest-cart write switch. Off by default: guest-cart writes throw without it. */
  guestCartWrites?: boolean;
}

type Env = Record<string, string | undefined>;

/** The store MAGENTO_STORE selects (production unless it says "sandbox"). */
export function magentoStore(env: Env = process.env): MagentoStore {
  return env.MAGENTO_STORE?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
}

/** Env-var prefix for a store's settings. */
export const STORE_PREFIX: Record<MagentoStore, string> = { production: "MAGENTO_", sandbox: "MAGENTO_SANDBOX_" };

/**
 * Resolve the MagentoContext for the selected store. Throws when that store is not configured
 * so callers fail loudly rather than silently hitting the wrong store.
 */
export function getMagentoContext(env: Env = process.env): MagentoContext {
  const store = magentoStore(env);
  const p = STORE_PREFIX[store];
  const baseUrl = env[`${p}BASE_URL`]?.trim();
  const username = (env[`${p}ADMIN_USERNAME`]?.trim() || (store === "sandbox" ? env.MAGENTO_ADMIN_USERNAME?.trim() : "")) ?? "";
  const password = env[`${p}ADMIN_PASSWORD`] || (store === "sandbox" ? env.MAGENTO_ADMIN_PASSWORD : "") || "";
  if (!baseUrl || !username || !password) {
    throw new Error(
      `Magento ${store} store not configured: set ${p}BASE_URL, ${p}ADMIN_USERNAME and ${p}ADMIN_PASSWORD.`,
    );
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error(`${p}BASE_URL must be an https:// origin.`);
  }
  return {
    store,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    username,
    password,
    // Never inherited across stores.
    guestCartWrites: env[`${p}GUEST_CART_WRITES`]?.trim().toLowerCase() === "true",
  };
}

/** Non-throwing variant: returns null when the store context is not configured. */
export function tryGetMagentoContext(env: Env = process.env): MagentoContext | null {
  try {
    return getMagentoContext(env);
  } catch {
    return null;
  }
}
