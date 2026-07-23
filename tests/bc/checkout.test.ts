import { describe, it, expect, afterEach } from "vitest";
import { placeTermsOrder, companyAddressToCheckout, type BcCheckoutAddress } from "@/lib/bc/checkout";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const billing: BcCheckoutAddress = { first_name: "Jane", last_name: "Doe", address1: "1 A St", city: "Austin", country_code: "US", postal_code: "78726" };
const shipping = billing;

const cartRoute: MockRoute = {
  method: "POST",
  url: "/v3/carts",
  body: {
    data: {
      id: "cart1",
      customer_id: 42,
      channel_id: 1,
      line_items: {
        physical_items: [
          { id: "pi1", product_id: 80, variant_id: 64, quantity: 3 },
          { id: "pi2", product_id: 81, quantity: 2 },
        ],
      },
    },
  },
};

function fullSequence(grandTotal: number): MockRoute[] {
  return [
    cartRoute,
    { method: "POST", url: "/billing-address", body: { data: {} } },
    {
      method: "POST",
      url: "/consignments",
      body: {
        data: {
          id: "cart1",
          consignments: [
            {
              id: "cons1",
              available_shipping_options: [
                { id: "opt-fast", cost: 50, description: "Express" },
                { id: "opt-slow", cost: 20, description: "Ground" },
              ],
            },
          ],
        },
      },
    },
    {
      method: "PUT",
      url: "/consignments/cons1",
      body: {
        data: { id: "cart1", grand_total: grandTotal, subtotal_ex_tax: 100, tax_total: 8, shipping_cost_total_inc_tax: 20 },
      },
    },
    { method: "POST", url: "/checkouts/cart1/orders", body: { data: { id: 9001 } } },
    { method: "PUT", url: "/v2/orders/9001", body: {} },
  ];
}

describe("placeTermsOrder happy path", () => {
  it("runs the full Checkout-V3 sequence, picks cheapest shipping, marks Pay on Account", async () => {
    const mock = installMockFetch(fullSequence(120.5));
    const result = await placeTermsOrder(TEST_CTX, {
      customerId: 42,
      companyId: 123,
      lineItems: [
        { productId: 80, variantId: 64, quantity: 3 },
        { productId: 81, quantity: 2 },
      ],
      billing,
      shipping,
      poNumber: "PO-555",
      credit: { limitPurchases: true, availableCredit: 5000 },
    });

    expect(result).toMatchObject({ ok: true, orderId: 9001, cartId: "cart1", shippingOption: "Ground" });
    if (result.ok) expect(result.totals).toEqual({ subtotal: 100, taxTotal: 8, shippingTotal: 20, grandTotal: 120.5 });

    // cheapest shipping option selected
    const putConsign = mock.calls.find((c) => c.method === "PUT" && c.url.includes("/consignments/cons1"));
    expect((putConsign?.body as { shipping_option_id: string }).shipping_option_id).toBe("opt-slow");

    // terms-order marking
    const v2 = mock.calls.find((c) => c.method === "PUT" && c.url.includes("/v2/orders/9001"));
    const v2Body = v2?.body as { status_id: number; payment_method: string; staff_notes: string };
    expect(v2Body.status_id).toBe(11);
    expect(v2Body.payment_method).toBe("Pay on Account");
    expect(v2Body.staff_notes).toContain("PO-555");
  });
});

describe("placeTermsOrder guards", () => {
  it("blocks on credit_exceeded before placing the order", async () => {
    const mock = installMockFetch(fullSequence(120.5));
    const result = await placeTermsOrder(TEST_CTX, {
      customerId: 42,
      companyId: 123,
      lineItems: [{ productId: 80, variantId: 64, quantity: 3 }],
      billing,
      shipping,
      credit: { limitPurchases: true, availableCredit: 100 }, // grand 120.5 > 100
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("credit_exceeded");
    // no order placed
    expect(mock.calls.some((c) => c.method === "POST" && c.url.includes("/checkouts/cart1/orders"))).toBe(false);
  });

  it("returns empty_cart when the cart has no physical items", async () => {
    installMockFetch([
      { method: "POST", url: "/v3/carts", body: { data: { id: "c0", customer_id: 42, channel_id: 1, line_items: { physical_items: [] } } } },
    ]);
    const result = await placeTermsOrder(TEST_CTX, {
      customerId: 42,
      companyId: 123,
      lineItems: [{ productId: 999, quantity: 1 }],
      billing,
      shipping,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty_cart");
  });

  it("returns no_shipping_option when none available", async () => {
    installMockFetch([
      cartRoute,
      { method: "POST", url: "/billing-address", body: { data: {} } },
      { method: "POST", url: "/consignments", body: { data: { id: "cart1", consignments: [{ id: "cons1", available_shipping_options: [] }] } } },
    ]);
    const result = await placeTermsOrder(TEST_CTX, {
      customerId: 42,
      companyId: 123,
      lineItems: [{ productId: 80, variantId: 64, quantity: 3 }],
      billing,
      shipping,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_shipping_option");
  });
});

describe("companyAddressToCheckout", () => {
  it("maps a B2B company address to a Checkout V3 address", () => {
    const out = companyAddressToCheckout({
      addressId: 1,
      firstName: "Jane",
      lastName: "Doe",
      addressLine1: "1 A St",
      city: "Austin",
      stateCode: "TX",
      stateName: "Texas",
      countryCode: "US",
      zipCode: "78726",
      isDefaultBilling: true,
      isDefaultShipping: true,
    });
    expect(out).toMatchObject({ first_name: "Jane", address1: "1 A St", state_or_province_code: "TX", country_code: "US", postal_code: "78726" });
  });
});
