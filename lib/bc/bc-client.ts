// Core BigCommerce Management API client (v2/v3), session-less. Ported from the
// accelerator's lib/bigcommerce/client.ts pattern. Base:
// https://api.bigcommerce.com/stores/{hash}. Auth: X-Auth-Token (same store token).

import type { StoreContext } from "./store-context";

function coreBase(storeHash: string): string {
  return `https://api.bigcommerce.com/stores/${storeHash}`;
}

/**
 * Raw core BC fetch. Returns the parsed JSON as-is (v3 wraps payloads in `{ data, meta }`;
 * v2 returns bare objects/arrays). Throws on non-2xx with the response body for context.
 * NOTE the token whitespace-strip — a real production bug where a copied token carried a
 * trailing newline and every call 401'd.
 */
export async function bcFetch<T>(
  ctx: StoreContext,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = ctx.accessToken.replace(/\s+/g, "");
  const url = path.startsWith("http") ? path : `${coreBase(ctx.storeHash)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-Auth-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BC API error ${res.status} at ${path}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** v3 convenience: unwrap the `{ data }` envelope. */
export async function bcFetchData<T>(
  ctx: StoreContext,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const json = await bcFetch<{ data: T }>(ctx, path, options);
  return json.data;
}
