import { describe, it, expect, afterEach } from "vitest";
import { getUserByEmail } from "@/lib/bc/users";
import { getCompany, getCompanyCreditConfig, getCompanyAddresses } from "@/lib/bc/companies";
import { getCompanyPaymentMethods } from "@/lib/bc/payments";
import { getProductsByIds } from "@/lib/bc/catalog";
import { B2BApiError } from "@/lib/bc/b2b-client";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

// Reads that feed a decision tell "the store says there's nothing" apart from "the call
// failed": only a genuine empty answer comes back empty/null, anything else throws, so an
// outage can't be mistaken for an unknown buyer, missing terms or an unchecked catalog.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const down = { status: 500, body: { code: 500, message: "upstream unavailable" } };

describe("B2B Edition read failures", () => {
  it("getUserByEmail throws on a failed call but is null on an empty match", async () => {
    installMockFetch([{ url: "/users?email=", ...down }]);
    await expect(getUserByEmail(TEST_CTX, "buyer@acme.com")).rejects.toBeInstanceOf(B2BApiError);

    installMockFetch([{ url: "/users?email=", body: { code: 200, data: [] } }]);
    expect(await getUserByEmail(TEST_CTX, "nobody@acme.com")).toBeNull();
  });

  it("getCompany is null on 404 and throws on other failures", async () => {
    installMockFetch([{ url: "/companies/123", status: 404, body: { code: 404, data: {}, meta: { message: "Not found" } } }]);
    expect(await getCompany(TEST_CTX, 123)).toBeNull();

    installMockFetch([{ url: "/companies/123", ...down }]);
    await expect(getCompany(TEST_CTX, 123)).rejects.toThrow(/500/);
  });

  it("getCompanyCreditConfig is null when store credit is disabled (400) and throws otherwise", async () => {
    installMockFetch([
      { url: "/companies/123/credit", status: 400, body: { code: 400, data: { errMsg: "Store company credit is not enabled" } } },
    ]);
    expect(await getCompanyCreditConfig(TEST_CTX, 123)).toBeNull();

    installMockFetch([{ url: "/companies/123/credit", ...down }]);
    await expect(getCompanyCreditConfig(TEST_CTX, 123)).rejects.toThrow(/500/);
  });

  it("addresses and payment methods throw instead of reading as empty", async () => {
    installMockFetch([{ url: "/addresses?companyId=123", ...down }]);
    await expect(getCompanyAddresses(TEST_CTX, 123)).rejects.toThrow(/500/);

    installMockFetch([{ url: "/companies/123/payments", ...down }]);
    await expect(getCompanyPaymentMethods(TEST_CTX, 123)).rejects.toThrow(/500/);
  });
});

describe("catalog read failures", () => {
  it("getProductsByIds throws instead of returning an empty map", async () => {
    installMockFetch([{ url: "/v3/catalog/products?id:in=", status: 503, body: "unavailable" }]);
    await expect(getProductsByIds(TEST_CTX, [80, 81])).rejects.toThrow(/503/);
  });
});
