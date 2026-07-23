import { describe, it, expect, afterEach } from "vitest";
import { createQuote, acceptQuote, computeExpiryDate, toCents, fromCents } from "@/lib/bc/quotes";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("cents helpers", () => {
  it("snaps to integer cents and back", () => {
    expect(toCents(9.199999999)).toBe(920);
    expect(toCents(9.84)).toBe(984);
    expect(fromCents(2972)).toBe(29.72);
  });
});

describe("createQuote invariant", () => {
  it("derives totals from integer cents; offeredPrice===basePrice; discount 0", async () => {
    const mock = installMockFetch([
      { method: "POST", url: "/rfq", body: { code: 200, data: { id: 9001, quoteNumber: "Q-9001", quoteUrl: "https://portal/quote/9001" } } },
    ]);
    const result = await createQuote(TEST_CTX, {
      companyId: 123,
      contactInfo: { name: "Jane Doe", email: "jane@acme.com", companyName: "Acme" },
      items: [
        { productId: 80, variantId: 64, sku: "A", quantity: 3, unitPrice: 9.84 },
        // a value that drifts under float addition (0.1 + 0.2 !== 0.3)
        { productId: 81, sku: "B", quantity: 2, unitPrice: 0.1 },
      ],
      channelId: 1,
      referenceNumber: "PO-555",
      quoteTitle: "PO-555 — Acme",
      expiredAt: "08/22/2026",
    });

    expect(result).toEqual({ quoteId: 9001, quoteNumber: "Q-9001", quoteUrl: "https://portal/quote/9001" });

    const body = mock.calls[0].body as {
      grandTotal: number;
      subtotal: number;
      discount: number;
      quoteReference: string;
      companyId: number;
      productList: Array<{ basePrice: number; offeredPrice: number; discount: number; quantity: number }>;
    };
    // 9.84*3 + 0.1*2 = 29.72 — exact, no float drift
    expect(body.grandTotal).toBe(29.72);
    expect(body.subtotal).toBe(body.grandTotal);
    expect(body.discount).toBe(0);
    expect(body.quoteReference).toBe("PO-555");
    expect(body.companyId).toBe(123);

    // invariant: subtotal === Σ(offeredPrice × qty), each offeredPrice === basePrice, discount 0
    const sum = body.productList.reduce((acc, li) => acc + li.offeredPrice * li.quantity, 0);
    expect(sum).toBe(body.grandTotal);
    for (const li of body.productList) {
      expect(li.offeredPrice).toBe(li.basePrice);
      expect(li.discount).toBe(0);
    }
  });
});

describe("acceptQuote", () => {
  it("returns the checkout link for an open quote", async () => {
    installMockFetch([
      {
        method: "POST",
        url: "/rfq/9001/checkout",
        body: { code: 200, data: { checkoutUrl: "https://store/checkout?x", cartId: "cart-1", cartUrl: "https://store/cart.php?x" } },
      },
    ]);
    const checkout = await acceptQuote(TEST_CTX, 9001);
    expect(checkout?.checkoutUrl).toBe("https://store/checkout?x");
    expect(checkout?.cartId).toBe("cart-1");
  });

  it("returns null when the quote is not open (404)", async () => {
    installMockFetch([{ method: "POST", url: "/rfq/9001/checkout", status: 404, body: { code: 404, message: "not open" } }]);
    expect(await acceptQuote(TEST_CTX, 9001)).toBeNull();
  });
});

describe("computeExpiryDate", () => {
  it("formats MM/DD/YYYY N days out", () => {
    expect(computeExpiryDate(30, new Date(2026, 6, 23))).toBe("08/22/2026");
    expect(computeExpiryDate(0, new Date(2026, 0, 5))).toBe("01/05/2026");
  });
});
