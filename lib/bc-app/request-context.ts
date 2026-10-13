import { cookies, headers } from "next/headers";
import { VIEW_COOKIE, VIEW_HEADER, parseView, type AdminView } from "@/lib/po-agent/admin-view";
import type { StoreContext } from "@/lib/bc/store-context";
import { tryGetStoreContext } from "@/lib/bc/store-context";
import { getRedis } from "@/lib/redis";
import {
  PREVIEW_COOKIE,
  isPreviewDeployment,
  loadPreviewSession,
  type PreviewGrant,
} from "@/lib/po-agent/preview-access";
import { verifiedStoreHash, resolveStoreContextForHash } from "./resolve-context";
import { storeContextForInstall } from "./store-tokens";

// Request-scoped StoreContext resolution: reads the signed poa_app cookie (set on the
// app /load callback) to determine the installed store, then uses its OAuth token; falls
// back to env for a single-store (Phase A) deployment.

/** The preview sign-in session (poa_preview) on this request — Vercel previews only. */
export async function previewGrant(): Promise<PreviewGrant | null> {
  if (!isPreviewDeployment()) return null;
  const redis = getRedis();
  if (!redis) return null;
  return loadPreviewSession(redis, (await cookies()).get(PREVIEW_COOKIE)?.value);
}

/**
 * The store hash the current request is signed into: the signed poa_app cookie, or — on a
 * Vercel preview only — the store bound to a preview sign-in session.
 */
export async function sessionStoreHash(): Promise<string | null> {
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  if (hash) return hash;
  return (await previewGrant())?.storeHash ?? null;
}

export async function resolveRequestStoreContext(): Promise<StoreContext | null> {
  return resolveStoreContextForHash(await sessionStoreHash());
}

/** Which store is active and where its token came from — for the admin display. */
export async function activeStoreSource(): Promise<{ storeHash?: string; source: "install" | "env" | "none" }> {
  const hash = await sessionStoreHash();
  if (hash && (await storeContextForInstall(hash))) return { storeHash: hash, source: "install" };
  const env = tryGetStoreContext();
  return env ? { storeHash: env.storeHash, source: "env" } : { source: "none" };
}

/** The admin view on this request: what middleware just selected (a dashboard visit), else
 * the remembered choice, else Silk. See lib/po-agent/admin-view.ts. */
export async function currentAdminView(): Promise<AdminView> {
  const picked = (await headers()).get(VIEW_HEADER);
  if (picked) return parseView(picked);
  return parseView((await cookies()).get(VIEW_COOKIE)?.value);
}
