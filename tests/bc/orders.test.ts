import { describe, it, expect, afterEach } from "vitest";
import { finalizeTermsOrder, getB2BOrderByBcId } from "@/lib/bc/orders";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const getOrder = (data: unknown): MockRoute => ({ method: "GET", url: "/orders/9001", body: { code: 200, data } });

describe("getB2BOrderByBcId", () => {
  it("maps the B2B order detail", async () => {
    installMockFetch([getOrder({ id: 555, bcOrderId: 9001, poNumber: null, invoiceId: null })]);
    const order = await getB2BOrderByBcId(TEST_CTX, 9001, { attempts: 1, delayMs: 0 });
    expect(order).toEqual({ id: 555, bcOrderId: 9001, poNumber: null, invoiceId: null });
  });

  it("returns null (pending) after exhausting attempts", async () => {
    installMockFetch([getOrder(null)]);
    expect(await getB2BOrderByBcId(TEST_CTX, 9001, { attempts: 2, delayMs: 0 })).toBeNull();
  });
});

describe("finalizeTermsOrder idempotency", () => {
  it("creates the invoice and sets the PO when neither is present", async () => {
    const mock = installMockFetch([
      getOrder({ id: 555, bcOrderId: 9001, poNumber: null, invoiceId: null }),
      { method: "PUT", url: "/orders/9001", body: { code: 200, data: {} } },
      { method: "POST", url: "/ip/orders/555/invoices", body: { code: 200, data: { id: 777, invoiceNumber: "INV-777" } } },
    ]);
    const result = await finalizeTermsOrder(TEST_CTX, 9001, { poNumber: "PO-555", attempts: 1, delayMs: 0 });
    expect(result).toEqual({ status: "created", invoiceId: 777, invoiceNumber: "INV-777" });

    // PO set via PUT with the poNumber
    const put = mock.calls.find((c) => c.method === "PUT" && c.url.includes("/orders/9001"));
    expect((put?.body as { poNumber: string }).poNumber).toBe("PO-555");
  });

  it("is a no-op invoice when already invoiced (exists)", async () => {
    const mock = installMockFetch([getOrder({ id: 555, bcOrderId: 9001, poNumber: "PO-555", invoiceId: 42 })]);
    const result = await finalizeTermsOrder(TEST_CTX, 9001, { poNumber: "PO-555", attempts: 1, delayMs: 0 });
    expect(result).toEqual({ status: "exists", invoiceId: 42 });
    // no invoice creation, no PO overwrite (already set)
    expect(mock.calls.some((c) => c.method === "POST" && c.url.includes("/invoices"))).toBe(false);
    expect(mock.calls.some((c) => c.method === "PUT" && c.url.includes("/orders/9001"))).toBe(false);
  });

  it("returns pending when the order has not synced to B2B yet", async () => {
    installMockFetch([getOrder(null)]);
    const result = await finalizeTermsOrder(TEST_CTX, 9001, { attempts: 1, delayMs: 0 });
    expect(result).toEqual({ status: "pending" });
  });
});
