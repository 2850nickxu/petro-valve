import { describe, it, expect } from "vitest";
import { cartLinkConfig, DEFAULT_CART_LINK_PATH, signCartLink, verifyCartLink } from "@/lib/magento/cart-link";

const CART = "M4sk3dC4rt1d000000000000000000ab";
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

describe("cartLinkConfig", () => {
  it("is off without a secret", () => {
    expect(cartLinkConfig({}, "https://petrovalve.com")).toBeNull();
  });
  it("defaults the path and TTL, and normalizes the origin and path", () => {
    expect(cartLinkConfig({ MAGENTO_CART_LINK_SECRET: "s" }, "https://petrovalve.com/")).toEqual({
      baseUrl: "https://petrovalve.com",
      secret: "s",
      path: DEFAULT_CART_LINK_PATH,
      ttlDays: 30,
    });
    expect(cartLinkConfig({ MAGENTO_CART_LINK_SECRET: "s", MAGENTO_CART_LINK_PATH: "po/cart", MAGENTO_CART_LINK_TTL_DAYS: "7" }, "https://x.com")).toMatchObject({
      path: "/po/cart",
      ttlDays: 7,
    });
  });
});

describe("signCartLink / verifyCartLink", () => {
  const cfg = cartLinkConfig({ MAGENTO_CART_LINK_SECRET: "shared-secret", MAGENTO_CART_LINK_TTL_DAYS: "30" }, "https://petrovalve.com")!;

  it("signs cart + expiry and verifies back to the cart id", () => {
    const link = signCartLink(cfg, CART, NOW);
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe(`https://petrovalve.com${DEFAULT_CART_LINK_PATH}`);
    expect(url.searchParams.get("cart")).toBe(CART);
    expect(Number(url.searchParams.get("exp"))).toBe(NOW / 1000 + 30 * 86_400);
    expect(verifyCartLink(cfg, link, NOW)).toBe(CART);
  });

  it("matches the Magento module's test vector (integrations/magento/Silk_CartLink)", () => {
    // Same vector as Model/Signature.php and the module README: both sides must produce it.
    const vector = cartLinkConfig({ MAGENTO_CART_LINK_SECRET: "test-secret-do-not-use" }, "https://petrovalve.com")!;
    const link = new URL(signCartLink({ ...vector, ttlDays: 1 }, CART, (1_790_000_000 - 86_400) * 1000));
    expect(link.searchParams.get("exp")).toBe("1790000000");
    expect(link.searchParams.get("sig")).toBe("o1Q0perHalq1gPwnSGigg30oGSn1A9UiUrytAewBPKs");
    expect(link.pathname).toBe("/silkcartlink/cart/open");
  });

  it("rejects a tampered cart, a tampered expiry, another secret, and an expired link", () => {
    const link = signCartLink(cfg, CART, NOW);
    const swapped = new URL(link);
    swapped.searchParams.set("cart", "x".repeat(32));
    expect(verifyCartLink(cfg, swapped.toString(), NOW)).toBeNull();
    const later = new URL(link);
    later.searchParams.set("exp", String(Number(later.searchParams.get("exp")) + 86_400));
    expect(verifyCartLink(cfg, later.toString(), NOW)).toBeNull();
    expect(verifyCartLink({ ...cfg, secret: "other" }, link, NOW)).toBeNull();
    expect(verifyCartLink(cfg, link, NOW + 31 * 86_400_000)).toBeNull();
    expect(verifyCartLink(cfg, "not a url", NOW)).toBeNull();
  });
});
