import { getRedis } from "@/lib/redis";
import type { StoreContext } from "@/lib/bc/store-context";

// Per-store OAuth token storage for the installable app. Keyed by store hash so one
// deployment can serve many merchants (the Phase-B multi-store model). This is what the
// StoreContext seam resolves from when running as an app instead of from env.

export interface StoreInstall {
  storeHash: string;
  accessToken: string;
  scope?: string;
  ownerEmail?: string;
  userEmail?: string;
  installedAt: string;
}

const key = (storeHash: string) => `poa:app:store:${storeHash}`;

export async function saveStoreInstall(install: StoreInstall): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  await redis.cmd(["SET", key(install.storeHash), JSON.stringify(install)]);
  return true;
}

export async function loadStoreInstall(storeHash: string): Promise<StoreInstall | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.cmd<string | null>(["GET", key(storeHash)]);
  return raw ? (JSON.parse(raw) as StoreInstall) : null;
}

export async function deleteStoreInstall(storeHash: string): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.cmd(["DEL", key(storeHash)]);
}

/** List installed stores (one-shot SCAN; token omitted). */
export async function listStoreInstalls(): Promise<Array<Omit<StoreInstall, "accessToken">>> {
  const redis = getRedis();
  if (!redis) return [];
  const [, keys] = await redis.cmd<[string, string[]]>(["SCAN", "0", "MATCH", "poa:app:store:*", "COUNT", "200"]);
  if (!keys?.length) return [];
  const raws = await redis.pipeline<string | null>(keys.map((k) => ["GET", k]));
  return raws
    .filter((r): r is string => Boolean(r))
    .map((r) => {
      const { accessToken: _omit, ...rest } = JSON.parse(r) as StoreInstall;
      void _omit;
      return rest;
    });
}

/** Resolve a StoreContext for an installed store (Phase-B path). */
export async function storeContextForInstall(
  storeHash: string,
  channelId = 1,
): Promise<StoreContext | null> {
  const install = await loadStoreInstall(storeHash);
  if (!install) return null;
  return { storeHash, accessToken: install.accessToken, channelId };
}
