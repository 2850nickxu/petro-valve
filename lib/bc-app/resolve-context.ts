import { verifyAppSession } from "./session";
import { bcAppCreds } from "./config";
import { storeContextForInstall } from "./store-tokens";
import { tryGetStoreContext, type StoreContext } from "@/lib/bc/store-context";

// The Phase-B StoreContext resolver (framework-free — no next/headers). When the app is
// installed, BC calls should use the per-store OAuth token (captured on /auth, stored in
// Redis) rather than the pasted env token. Resolution: verified store hash → install token
// → env fallback. Request-scoped helpers (cookie reading) live in ./request-context.

type Env = Record<string, string | undefined>;

/** Verify a poa_app cookie value and return its store hash, or null. */
export function verifiedStoreHash(cookieValue: string | undefined, env: Env = process.env): string | null {
  const creds = bcAppCreds(env);
  if (!creds || !cookieValue) return null;
  return verifyAppSession(cookieValue, creds.clientSecret);
}

/** Resolve a StoreContext for a specific store hash (install token), else env fallback. */
export async function resolveStoreContextForHash(
  storeHash: string | null,
  env: Env = process.env,
): Promise<StoreContext | null> {
  if (storeHash) {
    const channelId = parseInt(env.BIGCOMMERCE_CHANNEL_ID ?? "1", 10);
    const ctx = await storeContextForInstall(storeHash, channelId);
    if (ctx) return ctx;
  }
  return tryGetStoreContext(env);
}
