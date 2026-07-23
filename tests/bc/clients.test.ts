import { describe, it, expect, afterEach } from "vitest";
import { parseB2BEnvelope, b2bFetch } from "@/lib/bc/b2b-client";
import { bcFetch } from "@/lib/bc/bc-client";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseB2BEnvelope (3 envelope shapes)", () => {
  const res = (ok: boolean, status = 200) => ({ ok, status });

  it("unwraps { code:200, data }", () => {
    expect(parseB2BEnvelope(res(true), { code: 200, data: { x: 1 } }, "/p")).toEqual({ x: 1 });
  });
  it("unwraps { data, meta } with no code (the hierarchy bug case)", () => {
    expect(parseB2BEnvelope(res(true), { data: [1, 2], meta: {} }, "/p")).toEqual([1, 2]);
  });
  it("returns a bare array/object payload as-is", () => {
    expect(parseB2BEnvelope(res(true), [1, 2, 3], "/p")).toEqual([1, 2, 3]);
  });
  it("throws on explicit non-200 code with the message", () => {
    expect(() => parseB2BEnvelope(res(true), { code: 422, message: "bad" }, "/p")).toThrow(/422.*bad/);
  });
  it("throws on non-2xx HTTP", () => {
    expect(() => parseB2BEnvelope(res(false, 500), {}, "/p")).toThrow(/500/);
  });
});

describe("b2bFetch header + URL shaping", () => {
  it("targets the B2B base with X-Auth-Token + X-Store-Hash and unwraps data", async () => {
    const mock = installMockFetch([{ url: "/api/v3/io/companies/7", body: { code: 200, data: { companyId: 7 } } }]);
    const out = await b2bFetch<{ companyId: number }>(TEST_CTX, "/companies/7");
    expect(out).toEqual({ companyId: 7 });
    const call = mock.calls[0];
    expect(call.url).toBe("https://api-b2b.bigcommerce.com/api/v3/io/companies/7");
    expect(call.headers["x-auth-token"]).toBe("test-token");
    expect(call.headers["x-store-hash"]).toBe("teststore");
  });
});

describe("bcFetch core BC shaping + token whitespace strip", () => {
  it("targets stores/{hash}, strips whitespace from the token", async () => {
    const mock = installMockFetch([{ url: "/v3/catalog/products", body: { data: [], meta: {} } }]);
    const ctx = { ...TEST_CTX, accessToken: "  tok en\n" };
    await bcFetch(ctx, "/v3/catalog/products");
    const call = mock.calls[0];
    expect(call.url).toBe("https://api.bigcommerce.com/stores/teststore/v3/catalog/products");
    expect(call.headers["x-auth-token"]).toBe("token"); // whitespace removed
  });

  it("throws on non-2xx with body context", async () => {
    installMockFetch([{ url: "/v2/orders/9", status: 404, body: "not found" }]);
    await expect(bcFetch(TEST_CTX, "/v2/orders/9")).rejects.toThrow(/404/);
  });
});
