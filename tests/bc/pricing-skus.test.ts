import { describe, it, expect, afterEach } from "vitest";
import { getProductPrices, priceKey } from "@/lib/bc/pricing";
import { resolveSkusToIds } from "@/lib/bc/sku-resolver";
import { getPriceListIdForCompany } from "@/lib/bc/price-list";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("getProductPrices", () => {
  it("sends the pricing body and maps calculated_price (tax-exclusive)", async () => {
    const mock = installMockFetch([
      {
        method: "POST",
        url: "/v3/pricing/products",
        body: {
          data: [
            { product_id: 80, variant_id: 64, calculated_price: { as_entered: 10, tax_exclusive: 9.84, tax_inclusive: 10.6, entered_inclusive: false } },
            { product_id: 81, calculated_price: { as_entered: 5, tax_exclusive: 5, tax_inclusive: 5.4, entered_inclusive: false } },
          ],
        },
      },
    ]);
    const prices = await getProductPrices(TEST_CTX, {
      items: [{ productId: 80, variantId: 64 }, { productId: 81 }],
      customerId: 42,
      customerGroupId: 7,
    });
    expect(prices.get(priceKey(80, 64))?.unitPrice).toBe(9.84);
    expect(prices.get(priceKey(81))?.unitPrice).toBe(5);

    const sent = mock.calls[0].body as Record<string, unknown>;
    expect(sent.channel_id).toBe(1);
    expect(sent.customer_group_id).toBe(7);
    expect(sent.customer_id).toBe(42);
    expect(sent.items).toEqual([{ product_id: 80, variant_id: 64 }, { product_id: 81 }]);
  });
});

describe("resolveSkusToIds", () => {
  it("resolves variant SKUs first, then product-level to the default variant", async () => {
    installMockFetch([
      { url: "/v3/catalog/variants?sku:in=", body: { data: [{ id: 500, product_id: 80, sku: "VAR-1" }] } },
      {
        url: "/v3/catalog/products?sku:in=",
        body: {
          data: [
            { id: 90, sku: "PROD-2", variants: [{ id: 900, sku: "PROD-2-DEF", product_id: 90 }] },
            { id: 91, sku: "IGNORED", variants: [{ id: 910, sku: "VAR-3", product_id: 91 }] },
          ],
        },
      },
    ]);
    const map = await resolveSkusToIds(TEST_CTX, ["VAR-1", "PROD-2", "VAR-3", "MISSING"]);
    expect(map.get("VAR-1")).toEqual({ productId: 80, variantId: 500 });
    expect(map.get("PROD-2")).toEqual({ productId: 90, variantId: 900 }); // default variant
    expect(map.get("VAR-3")).toEqual({ productId: 91, variantId: 910 }); // nested variant sku
    expect(map.has("MISSING")).toBe(false);
  });

  it("returns empty for empty input without hitting the network", async () => {
    installMockFetch([]); // any call would throw
    const map = await resolveSkusToIds(TEST_CTX, ["", "  "]);
    expect(map.size).toBe(0);
  });
});

describe("getPriceListIdForCompany precedence", () => {
  it("prefers the direct company assignment for this channel", async () => {
    installMockFetch([
      {
        url: "/companies/1",
        body: { code: 200, data: { companyId: 1, companyName: "A", companyStatus: 1, priceListAssign: [{ priceListId: 55, channelId: 1 }] } },
      },
    ]);
    expect(await getPriceListIdForCompany(TEST_CTX, 1)).toBe(55);
  });

  it("falls back to the company's customer-group price list", async () => {
    installMockFetch([
      { url: "/companies/2", body: { code: 200, data: { companyId: 2, companyName: "B", companyStatus: 1, bcGroupId: 7 } } },
      { url: "/v3/pricelists/assignments?customer_group_id=7", body: { data: [{ price_list_id: 88, customer_group_id: 7, channel_id: 1 }] } },
    ]);
    expect(await getPriceListIdForCompany(TEST_CTX, 2)).toBe(88);
  });
});
