import { describe, it, expect, afterEach } from "vitest";
import { identify } from "@/lib/po-agent/core/identify";
import { resolveLines, submittableLines } from "@/lib/po-agent/core/resolve";
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

  it("flags a parent SKU instead of silently picking a child variant", async () => {
    installMockFetch([
      { url: "/v3/catalog/variants?sku:in=", body: { data: [] } },
      {
        url: "/v3/catalog/products?sku:in=",
        body: {
          data: [
            {
              id: 90,
              sku: "EA-EXEM-SR",
              variants: [
                { id: 901, product_id: 90, sku: "EA-EXEM-SR-2FT", option_values: [{ option_display_name: "Length", label: "2 ft" }] },
                { id: 902, product_id: 90, sku: "EA-EXEM-SR-4FT", option_values: [{ option_display_name: "Length", label: "4 ft" }] },
              ],
            },
          ],
        },
      },
      {
        url: "/v3/catalog/products?id:in=",
        body: { data: [{ id: 90, name: "Exempt Series Retrofit", sku: "EA-EXEM-SR", is_visible: true, availability: "available", inventory_tracking: "variant", inventory_level: 0, order_quantity_minimum: 0, order_quantity_maximum: 0 }] },
      },
    ]);
    const resolved = await resolveLines(TEST_CTX, [line({ sku: "EA-EXEM-SR", quantity: 40 })]);
    expect(resolved[0]).toMatchObject({ productId: 90, parentSku: true, variantChoiceCount: 2 });
    expect(resolved[0].variantId).toBeUndefined();
    expect(resolved[0].issues).toEqual(["line_parent_sku"]);
    expect(resolved[0].variantChoices).toEqual([
      { variantId: 901, sku: "EA-EXEM-SR-2FT", optionLabel: "Length: 2 ft" },
      { variantId: 902, sku: "EA-EXEM-SR-4FT", optionLabel: "Length: 4 ft" },
    ]);
    // Stock lives on the child, so no phantom shortfall off the parent's level.
    expect(resolved[0].issues).not.toContain("line_inventory_short");
    expect(submittableLines(resolved)).toEqual([]);
  });

  it("treats a multi-variant product as a parent even without option_values", async () => {
    installMockFetch([
      { url: "/v3/catalog/variants?sku:in=", body: { data: [] } },
      {
        url: "/v3/catalog/products?sku:in=",
        body: {
          data: [
            {
              id: 91,
              sku: "PARENT-2",
              variants: [
                { id: 911, product_id: 91, sku: "PARENT-2-A" },
                { id: 912, product_id: 91, sku: "PARENT-2-B" },
              ],
            },
          ],
        },
      },
      { url: "/v3/catalog/products?id:in=", body: { data: [] } },
    ]);
    const resolved = await resolveLines(TEST_CTX, [line({ sku: "PARENT-2", quantity: 1 })]);
    expect(resolved[0].parentSku).toBe(true);
    expect(resolved[0].issues).toContain("line_parent_sku");
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

  it("prices a parent line's children, not the parent itself", async () => {
    const mock = installMockFetch([
      {
        method: "POST",
        url: "/v3/pricing/products",
        body: {
          data: [
            { product_id: 90, variant_id: 901, calculated_price: { as_entered: 18.4, tax_exclusive: 18.4, tax_inclusive: 19, entered_inclusive: false } },
            { product_id: 90, variant_id: 902, calculated_price: { as_entered: 24.75, tax_exclusive: 24.75, tax_inclusive: 26, entered_inclusive: false } },
          ],
        },
      },
    ]);
    const resolved: ResolvedLine[] = [
      {
        line: line({ sku: "EA-EXEM-SR", quantity: 40, statedUnitPrice: 9.84 }),
        productId: 90,
        parentSku: true,
        variantChoices: [
          { variantId: 901, sku: "EA-EXEM-SR-2FT" },
          { variantId: 902, sku: "EA-EXEM-SR-4FT" },
        ],
        issues: ["line_parent_sku"],
      },
    ];
    const priced = await priceLines(TEST_CTX, resolved, { customerId: 42, tolerancePct: 1 });

    const sent = mock.callsTo("/v3/pricing/products")[0].body as { items: unknown[] };
    expect(sent.items).toEqual([
      { product_id: 90, variant_id: 901 },
      { product_id: 90, variant_id: 902 },
    ]);
    expect(priced[0].variantChoices?.map((c) => c.unitPrice)).toEqual([18.4, 24.75]);
    // No line price to compare against yet — so no invented total and no price_mismatch.
    expect(priced[0].calculatedUnitPrice).toBeUndefined();
    expect(priced[0].issues).not.toContain("price_mismatch");
    expect(estimatedSubtotal(priced)).toBe(0);
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
