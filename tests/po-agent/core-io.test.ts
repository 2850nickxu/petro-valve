import { describe, it, expect, afterEach } from "vitest";
import { identify } from "@/lib/po-agent/core/identify";
import { resolveLines } from "@/lib/po-agent/core/resolve";
import { priceLines, estimatedSubtotal } from "@/lib/po-agent/core/price";
import { createToolBelt } from "@/lib/po-agent/tools/belt";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";
import type { PoLineItem, ResolvedLine } from "@/lib/po-agent/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const line = (over: Partial<PoLineItem>): PoLineItem => ({
  rawText: "x",
  sku: null,
  description: null,
  quantity: null,
  statedUnitPrice: null,
  statedTotal: null,
  ...over,
});

describe("identify", () => {
  it("builds a buyer from user + approved company", async () => {
    installMockFetch([
      { url: "/users?email=", body: { code: 200, data: [{ id: 1, email: "jane@acme.com", role: "1", customerId: 42, companyId: 123, channelList: [{ channelId: 1 }] }] } },
      { url: "/companies/123", body: { code: 200, data: { companyId: 123, companyName: "Acme", companyStatus: 1, bcGroupId: 7 } } },
    ]);
    const r = await identify(TEST_CTX, "jane@acme.com");
    expect(r.companyApproved).toBe(true);
    expect(r.buyer).toMatchObject({ customerId: 42, companyId: 123, companyName: "Acme", customerGroupId: 7, channelList: [1] });
    expect(r.issues).toEqual([]);
  });

  it("returns unknown_sender for an unrecognized email", async () => {
    installMockFetch([{ url: "/users?email=", body: { code: 200, data: [] } }]);
    const r = await identify(TEST_CTX, "nobody@x.com");
    expect(r.buyer).toBeNull();
    expect(r.issues).toEqual(["unknown_sender"]);
  });
});

const catalogRoutes: MockRoute[] = [
  { url: "/v3/catalog/variants?sku:in=", body: { data: [{ id: 64, product_id: 80, sku: "WIDGET-100" }] } },
  { url: "/v3/catalog/products?sku:in=", body: { data: [{ id: 81, sku: "BOLT-250", variants: [{ id: 810, sku: "BOLT-250-D", product_id: 81 }] }] } },
];

describe("resolveLines", () => {
  it("resolves SKUs, checks purchasability, flags no-SKU/no-qty lines", async () => {
    installMockFetch([
      ...catalogRoutes,
      {
        url: "/v3/catalog/products?id:in=",
        body: {
          data: [
            { id: 80, name: "Widget", sku: "WIDGET-100", is_visible: true, availability: "available", inventory_tracking: "variant", inventory_level: 100, order_quantity_minimum: 0, order_quantity_maximum: 0 },
            { id: 81, name: "Bolt", sku: "BOLT-250", is_visible: true, availability: "available", inventory_tracking: "none", inventory_level: 0, order_quantity_minimum: 0, order_quantity_maximum: 0 },
          ],
        },
      },
    ]);
    const resolved = await resolveLines(TEST_CTX, [
      line({ sku: "WIDGET-100", quantity: 10 }),
      line({ sku: "BOLT-250", quantity: 40 }),
      line({ rawText: "mystery item", sku: null, quantity: null }),
    ]);
    expect(resolved[0]).toMatchObject({ productId: 80, variantId: 64, issues: [] });
    expect(resolved[1]).toMatchObject({ productId: 81, variantId: 810, issues: [] });
    expect(resolved[2].issues).toEqual(expect.arrayContaining(["line_unresolved", "missing_quantity"]));
  });

  it("flags inventory shortfall and quantity bounds", async () => {
    installMockFetch([
      { url: "/v3/catalog/variants?sku:in=", body: { data: [{ id: 64, product_id: 80, sku: "WIDGET-100" }] } },
      { url: "/v3/catalog/products?sku:in=", body: { data: [] } },
      {
        url: "/v3/catalog/products?id:in=",
        body: { data: [{ id: 80, name: "Widget", sku: "WIDGET-100", is_visible: true, availability: "available", inventory_tracking: "product", inventory_level: 5, order_quantity_minimum: 0, order_quantity_maximum: 3 }] },
      },
    ]);
    const resolved = await resolveLines(TEST_CTX, [line({ sku: "WIDGET-100", quantity: 10 })]);
    expect(resolved[0].issues).toEqual(expect.arrayContaining(["line_qty_bounds", "line_inventory_short"]));
  });
});

describe("priceLines", () => {
  it("applies store pricing and flags out-of-tolerance stated prices", async () => {
    installMockFetch([
      {
        method: "POST",
        url: "/v3/pricing/products",
        body: {
          data: [
            { product_id: 80, variant_id: 64, calculated_price: { as_entered: 9.84, tax_exclusive: 9.84, tax_inclusive: 10, entered_inclusive: false } },
            { product_id: 81, calculated_price: { as_entered: 5, tax_exclusive: 5, tax_inclusive: 5.4, entered_inclusive: false } },
          ],
        },
      },
    ]);
    const resolved: ResolvedLine[] = [
      { line: line({ sku: "A", quantity: 10, statedUnitPrice: 9.84 }), productId: 80, variantId: 64, issues: [] },
      { line: line({ sku: "B", quantity: 2, statedUnitPrice: 100 }), productId: 81, issues: [] },
    ];
    const priced = await priceLines(TEST_CTX, resolved, { customerId: 42, customerGroupId: 7, tolerancePct: 1 });
    expect(priced[0].calculatedUnitPrice).toBe(9.84);
    expect(priced[0].issues).not.toContain("price_mismatch");
    expect(priced[1].issues).toContain("price_mismatch");
    expect(estimatedSubtotal(priced)).toBeCloseTo(9.84 * 10 + 5 * 2, 5);
  });
});

describe("tool belt (read-only)", () => {
  it("executes a read tool against lib/bc", async () => {
    installMockFetch([{ url: "/users?email=", body: { code: 200, data: [{ id: 1, email: "jane@acme.com", role: "1", customerId: 42, companyId: 123 }] } }]);
    const belt = createToolBelt(TEST_CTX, { customerId: 42 });
    const out = (await belt.lookup_user_by_email.execute!({ email: "jane@acme.com" }, { toolCallId: "t", messages: [] } as any)) as { email?: string };
    expect(out.email).toBe("jane@acme.com");
  });
});
