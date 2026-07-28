import { describe, it, expect, afterEach } from "vitest";
import { placeTermsOrder, type BcCheckoutAddress } from "@/lib/bc/checkout";
import { submitQuote } from "@/lib/po-agent/core/submit-quote";
import { SANDBOX_NOTE } from "@/lib/po-agent/core/submit-order";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";
import type { Buyer, ResolvedLine } from "@/lib/po-agent/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const addr: BcCheckoutAddress = { first_name: "Jane", last_name: "Doe", address1: "1 A St", city: "Austin", country_code: "US", postal_code: "78726" };

function orderSequence(): MockRoute[] {
  return [
    { method: "POST", url: "/v3/carts", body: { data: { id: "cart1", customer_id: 42, channel_id: 1, line_items: { physical_items: [{ id: "pi1", product_id: 80, quantity: 1 }] } } } },
    { method: "POST", url: "/billing-address", body: { data: {} } },
    { method: "POST", url: "/consignments", body: { data: { id: "cart1", consignments: [{ id: "cons1", available_shipping_options: [{ id: "opt", cost: 5, description: "Ground" }] }] } } },
    { method: "PUT", url: "/consignments/cons1", body: { data: { id: "cart1", grand_total: 10, subtotal_ex_tax: 5, tax_total: 0, shipping_cost_total_inc_tax: 5 } } },
    { method: "POST", url: "/checkouts/cart1/orders", body: { data: { id: 9001 } } },
    { method: "PUT", url: "/v2/orders/9001", body: {} },
  ];
}

describe("sandbox marker — order path", () => {
  it("appends the sandbox note to staff_notes when noteSuffix is set", async () => {
    const mock = installMockFetch(orderSequence());
    await placeTermsOrder(TEST_CTX, {
      customerId: 42,
      companyId: 123,
      lineItems: [{ productId: 80, quantity: 1 }],
      billing: addr,
      shipping: addr,
      poNumber: "PO-1",
      noteSuffix: SANDBOX_NOTE,
    });
    const v2 = mock.calls.find((c) => c.method === "PUT" && c.url.includes("/v2/orders/9001"));
    expect((v2?.body as { staff_notes: string }).staff_notes).toContain("[PO agent sandbox]");
    expect((v2?.body as { staff_notes: string }).staff_notes).toContain("PO-1");
  });
});

describe("sandbox marker — quote path", () => {
  const buyer: Buyer = { email: "jane@acme.com", b2bUserId: 1, customerId: 42, companyId: 123, role: 1, companyName: "Acme" };
  const line: ResolvedLine = {
    line: { rawText: "WIDGET x1", sku: "WIDGET-100", description: null, quantity: 1, statedUnitPrice: 9.84, statedTotal: null },
    productId: 80,
    variantId: 64,
    matchedSku: "WIDGET-100",
    calculatedUnitPrice: 9.84,
    issues: [],
  };

  it("adds the sandbox note to quoteNotes when sandbox is true", async () => {
    const mock = installMockFetch([
      { method: "POST", url: "/rfq", body: { code: 200, data: { id: 9001, quoteNumber: "Q-9001", quoteUrl: "https://portal/quote/9001" } } },
      { method: "POST", url: "/rfq/9001/checkout", body: { code: 200, data: { checkoutUrl: "https://checkout" } } },
    ]);
    await submitQuote(TEST_CTX, { buyer, channelId: 1, resolvedLines: [line], poNumber: "PO-1", expiryDays: 30, sandbox: true });
    const rfq = mock.calls.find((c) => c.method === "POST" && /\/rfq$/.test(c.url.split("?")[0]));
    expect((rfq?.body as { quoteNotes?: string }).quoteNotes).toContain("[PO agent sandbox]");
  });

  it("omits quoteNotes when not a sandbox run and no notes given", async () => {
    const mock = installMockFetch([
      { method: "POST", url: "/rfq", body: { code: 200, data: { id: 9002, quoteNumber: "Q-9002" } } },
      { method: "POST", url: "/rfq/9002/checkout", body: { code: 200, data: { checkoutUrl: "https://checkout" } } },
    ]);
    await submitQuote(TEST_CTX, { buyer, channelId: 1, resolvedLines: [line], poNumber: "PO-1", expiryDays: 30 });
    const rfq = mock.calls.find((c) => c.method === "POST" && /\/rfq$/.test(c.url.split("?")[0]));
    expect((rfq?.body as { quoteNotes?: string }).quoteNotes).toBeUndefined();
  });
});
