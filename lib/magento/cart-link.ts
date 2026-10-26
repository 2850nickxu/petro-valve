// Signed cart links. Stock Magento can't open an API-created guest cart from an email link,
// so a small Silk Magento module (integrations/magento/Silk_CartLink) serves
//   {store}{path}?cart={maskedId}&exp={unix seconds}&sig={base64url HMAC-SHA256("{maskedId}.{exp}")}
// verify the signature and expiry, load the guest cart into the visitor's session and redirect
// to /checkout/cart. The agent signs links in that format today; verifyCartLink() is the
// reference check the module must match. Until the module is deployed the link won't open.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface CartLinkConfig {
  /** Store origin, e.g. https://petrovalve.com. */
  baseUrl: string;
  /** Shared with the Magento module. */
  secret: string;
  /** Path the module serves. */
  path: string;
  /** How long a link stays valid. */
  ttlDays: number;
}

/** The route Silk_CartLink serves (integrations/magento/Silk_CartLink). */
export const DEFAULT_CART_LINK_PATH = "/silkcartlink/cart/open";
const DEFAULT_TTL_DAYS = 30;

/** Link settings from env, or null when MAGENTO_CART_LINK_SECRET isn't set (no links then). */
export function cartLinkConfig(env: Record<string, string | undefined>, baseUrl: string): CartLinkConfig | null {
  const secret = env.MAGENTO_CART_LINK_SECRET?.trim();
  if (!secret) return null;
  const path = env.MAGENTO_CART_LINK_PATH?.trim() || DEFAULT_CART_LINK_PATH;
  const ttl = Number(env.MAGENTO_CART_LINK_TTL_DAYS);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    secret,
    path: path.startsWith("/") ? path : `/${path}`,
    ttlDays: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_DAYS,
  };
}

const sign = (secret: string, maskedId: string, exp: number) =>
  createHmac("sha256", secret).update(`${maskedId}.${exp}`).digest("base64url");

export function signCartLink(cfg: CartLinkConfig, maskedId: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + Math.round(cfg.ttlDays * 86_400);
  const q = new URLSearchParams({ cart: maskedId, exp: String(exp), sig: sign(cfg.secret, maskedId, exp) });
  return `${cfg.baseUrl}${cfg.path}?${q.toString()}`;
}

/** The masked cart id a valid, unexpired link carries; null when the link doesn't verify. */
export function verifyCartLink(cfg: CartLinkConfig, link: string, nowMs = Date.now()): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const cart = url.searchParams.get("cart");
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!cart || !Number.isInteger(exp) || exp * 1000 < nowMs) return null;
  const want = Buffer.from(sign(cfg.secret, cart, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? cart : null;
}
