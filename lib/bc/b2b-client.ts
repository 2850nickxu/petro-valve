// BigCommerce B2B Edition Management API client (session-less; takes a StoreContext).
// Ported from the accelerator's lib/b2b/client.ts. Auth: X-Auth-Token + X-Store-Hash
// (the SAME store token — there is no separate B2B token). Always no-store: this runs
// in a worker/cron context where decision-time freshness matters more than caching.

import type { StoreContext } from "./store-context";

export const B2B_API_BASE = "https://api-b2b.bigcommerce.com/api/v3/io";
export const B2B_GRAPHQL = "https://api-b2b.bigcommerce.com/graphql";

/** A B2B Edition call that failed, carrying the status so callers can tell "not found" from "down". */
export class B2BApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "B2BApiError";
  }
}

/** True when `err` is a B2B Edition error with one of the given statuses. */
export function isB2BStatus(err: unknown, ...statuses: number[]): boolean {
  return err instanceof B2BApiError && statuses.includes(err.status);
}

// B2B Edition response envelopes are INCONSISTENT: most return `{ code: 200, data }`,
// some return `{ data, meta }` with NO `code`, and a few return a bare array. Treat any
// 2xx HTTP response as success (preferring the `data` envelope when present) and only
// error on a non-2xx HTTP status or an EXPLICIT non-200 `code`.
export function parseB2BEnvelope<T>(
  res: { ok: boolean; status: number },
  json: unknown,
  path: string,
): T {
  const env = (json ?? {}) as { code?: number; data?: unknown; message?: string };
  const hasNumericCode = typeof env.code === "number";
  if (!res.ok || (hasNumericCode && env.code !== 200)) {
    const detail = env.message || JSON.stringify(env.data ?? json);
    const status = hasNumericCode ? env.code! : res.status;
    throw new B2BApiError(status, `B2B API error ${status} at ${path}: ${detail}`);
  }
  return (json && typeof json === "object" && "data" in (json as object)
    ? (json as { data: unknown }).data
    : json) as T;
}

export async function b2bFetch<T>(
  ctx: StoreContext,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${B2B_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Auth-Token": ctx.accessToken,
      "X-Store-Hash": ctx.storeHash,
      ...options.headers,
    },
    cache: "no-store",
  });
  const json = await res.json();
  return parseB2BEnvelope<T>(res, json, path);
}

/**
 * Mint a B2B storefront JWT for a specific customer (server-side, no password). Retained
 * for any FUTURE buyer-scoped read; the PO agent's submit path never uses it — all
 * company/credit/quote reads go through the Management API (b2bFetch) instead.
 */
export async function getB2BStorefrontToken(
  ctx: StoreContext,
  customerId: number,
): Promise<string | null> {
  try {
    const res = await fetch("https://api-b2b.bigcommerce.com/api/io/auth/customers/storefront", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": ctx.accessToken,
        "X-Store-Hash": ctx.storeHash,
      },
      body: JSON.stringify({ customerId, channelId: ctx.channelId }),
      cache: "no-store",
    });
    const json = (await res.json()) as { code?: number; data?: { token?: string | string[] } };
    if (json.code !== 200) return null;
    const t = json.data?.token;
    return Array.isArray(t) ? (t[0] ?? null) : (t ?? null);
  } catch {
    return null;
  }
}
