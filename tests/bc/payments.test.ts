import { describe, it, expect, afterEach } from "vitest";
import { getCompanyPaymentMethods, hasEnabledPaymentCode } from "@/lib/bc/payments";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("company payment methods", () => {
  it("maps data[] of { paymentId, code, paymentTitle, isEnabled }", async () => {
    installMockFetch([
      {
        url: "/companies/123/payments",
        body: {
          code: 200,
          data: [
            { paymentId: 1, code: "purchase_order", paymentTitle: "Pay on Account", isEnabled: true },
            { paymentId: 2, code: "credit_card", paymentTitle: "Card", isEnabled: true },
            { paymentId: 3, code: "cheque", paymentTitle: "Cheque", isEnabled: false },
          ],
        },
      },
    ]);
    const methods = await getCompanyPaymentMethods(TEST_CTX, 123);
    expect(methods).toHaveLength(3);
    expect(hasEnabledPaymentCode(methods, ["purchase_order", "cheque", "terms"])).toBe(true);
    // cheque exists but is disabled; card is enabled but not a PO code
    expect(hasEnabledPaymentCode(methods, ["cheque"])).toBe(false);
    expect(hasEnabledPaymentCode(methods, ["terms"])).toBe(false);
  });

  it("is case-insensitive on the code and empty on error", async () => {
    installMockFetch([
      { url: "/companies/9/payments", body: { code: 200, data: [{ paymentId: 1, code: "PURCHASE_ORDER", paymentTitle: "PO", isEnabled: 1 }] } },
    ]);
    const methods = await getCompanyPaymentMethods(TEST_CTX, 9);
    expect(hasEnabledPaymentCode(methods, ["purchase_order"])).toBe(true);
  });
});
