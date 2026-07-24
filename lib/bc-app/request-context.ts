import { cookies } from "next/headers";
import type { StoreContext } from "@/lib/bc/store-context";
import { tryGetStoreContext } from "@/lib/bc/store-context";
import { verifiedStoreHash, resolveStoreContextForHash } from "./resolve-context";
import { storeContextForInstall } from "./store-tokens";

// Request-scoped StoreContext resolution: reads the signed poa_app cookie (set on the
// app /load callback) to determine the installed store, then uses its OAuth token; falls
// back to env for a single-store (Phase A) deployment.

export async function resolveRequestStoreContext(): Promise<StoreContext | null> {
  const jar = await cookies();
  const hash = verifiedStoreHash(jar.get("poa_app")?.value);
  return resolveStoreContextForHash(hash);
}

/** Which store is active and where its token came from — for the admin display. */
export async function activeStoreSource(): Promise<{ storeHash?: string; source: "install" | "env" | "none" }> {
  const jar = await cookies();
  const hash = verifiedStoreHash(jar.get("poa_app")?.value);
  if (hash && (await storeContextForInstall(hash))) return { storeHash: hash, source: "install" };
  const env = tryGetStoreContext();
  return env ? { storeHash: env.storeHash, source: "env" } : { source: "none" };
}
