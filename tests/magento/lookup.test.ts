import { describe, it, expect } from "vitest";
import { lookupRow, parseLookupLine } from "@/lib/magento/lookup";
import { adminStatus, isOperational, storeConnected } from "@/lib/po-agent/admin-status";
import type { MagentoProduct } from "@/lib/magento/types";

const product = (over: Partial<MagentoProduct> = {}): MagentoProduct => ({
  id: 11,
  sku: "VO 12111-1",
  name: "VO 12111-1",
  typeId: "simple",
  enabled: true,
  visibility: 1,
  price: 135,
  priceAnomaly: false,
  attributes: { short_description: "GATE 1 800# A105" },
  ...over,
});

describe("parseLookupLine", () => {
  it.each([
    ["VO 12111-1, 2", { input: "VO 12111-1", qty: 2 }],
    ["VO 12111-1 x 3", { input: "VO 12111-1", qty: 3 }],
    ["VO 12111-1\t4", { input: "VO 12111-1", qty: 4 }],
    ["VO 12111-1 qty: 5", { input: "VO 12111-1", qty: 5 }],
    ['vo 12111 1 1/2"', { input: 'vo 12111 1 1/2"', qty: null }],
    ["VO 12111-1-1/2", { input: "VO 12111-1-1/2", qty: null }],
  ])("%s", (raw, expected) => {
    expect(parseLookupLine(raw)).toEqual(expected);
  });
  it("skips blank lines", () => {
    expect(parseLookupLine("   ")).toBeNull();
  });
});

describe("lookupRow", () => {
  it("only an enabled, really-priced simple product is cartable", () => {
    expect(lookupRow("VO 12111-1", 2, { status: "matched", input: "VO 12111-1", product: product(), exact: true })).toMatchObject({
      status: "matched",
      sku: "VO 12111-1",
      name: "GATE 1 800# A105",
      price: 135,
      cartable: true,
    });
    expect(lookupRow("x", 1, { status: "matched", input: "x", product: product({ priceAnomaly: true, price: 0.01 }), exact: true }).cartable).toBe(false);
    expect(lookupRow("x", 1, { status: "matched", input: "x", product: product({ enabled: false }), exact: true }).cartable).toBe(false);
    expect(lookupRow("x", 1, undefined)).toEqual({ input: "x", qty: 1, status: "unresolved", cartable: false });
    // A recommendation is confirmed with the customer first, and a line with no quantity is asked about.
    expect(lookupRow("12111-1", 1, { status: "matched", input: "12111-1", product: product(), exact: false }).cartable).toBe(false);
    expect(lookupRow("VO 12111-1", null, { status: "matched", input: "VO 12111-1", product: product(), exact: true }).cartable).toBe(false);
  });
  it("never carries cost or other attributes to the browser", () => {
    const row = lookupRow("VO 12111-1", 1, { status: "matched", input: "VO 12111-1", product: product({ attributes: { short_description: "GATE", ecc_brand: "Vogt" } }), exact: true });
    expect(Object.keys(row).sort()).toEqual(["cartable", "enabled", "exact", "input", "name", "price", "priceAnomaly", "qty", "sku", "status"]);
  });
});

describe("adminStatus — commerce platform", () => {
  const magentoEnv = {
    PO_AGENT_COMMERCE: "magento",
    MAGENTO_BASE_URL: "https://petrovalve.com",
    MAGENTO_ADMIN_USERNAME: "a",
    MAGENTO_ADMIN_PASSWORD: "b",
  };

  it("BigCommerce stays the default", () => {
    const s = adminStatus({});
    expect(s.commerce).toEqual({ platform: "bigcommerce" });
    expect(storeConnected(s)).toBe(false);
  });

  it("reports the Magento store, writes and links", () => {
    const s = adminStatus({ ...magentoEnv, MAGENTO_GUEST_CART_WRITES: "true", MAGENTO_CART_LINK_SECRET: "s" });
    expect(s.commerce).toEqual({
      platform: "magento",
      magento: { store: "production", configured: true, baseUrl: "https://petrovalve.com", guestCartWrites: true, cartLinks: true },
    });
    expect(storeConnected(s)).toBe(true);
    expect(adminStatus(magentoEnv).commerce.magento).toMatchObject({ guestCartWrites: false, cartLinks: false });
  });

  it("the sandbox is reported as the active store, with its own write switch", () => {
    const s = adminStatus({
      ...magentoEnv,
      MAGENTO_GUEST_CART_WRITES: "true",
      MAGENTO_STORE: "sandbox",
      MAGENTO_SANDBOX_BASE_URL: "https://petrovalve-test.epicorcommerce.com",
    });
    expect(s.commerce.magento).toMatchObject({ store: "sandbox", baseUrl: "https://petrovalve-test.epicorcommerce.com", guestCartWrites: false });
  });

  it("operational needs the Magento store, not a BigCommerce one", () => {
    const live = { ...magentoEnv, PO_AGENT_ENABLED: "true", UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t", MS_PO_TENANT_ID: "t", MS_PO_CLIENT_ID: "c", MS_PO_CLIENT_SECRET: "s", MS_PO_MAILBOX: "m@x.com" };
    expect(isOperational(adminStatus(live))).toBe(true);
    expect(isOperational(adminStatus({ ...live, MAGENTO_ADMIN_PASSWORD: "" }))).toBe(false);
  });
});
