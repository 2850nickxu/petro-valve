import { describe, it, expect, afterEach } from "vitest";
import { getUserByEmail, mapUser } from "@/lib/bc/users";
import {
  getCompany,
  getCompanyCreditConfig,
  isCompanyOnCreditHold,
  getCompanyPaymentTerms,
  getCompanyAddresses,
  defaultBilling,
  defaultShipping,
  isCompanyApproved,
} from "@/lib/bc/companies";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("getUserByEmail mapping", () => {
  it("coerces string role → number and flattens channelList", async () => {
    installMockFetch([
      {
        url: "/users?email=",
        body: {
          code: 200,
          data: [
            {
              id: 456,
              firstName: "Jane",
              lastName: "Doe",
              email: "jane@acme.com",
              role: "1",
              companyRoleId: 9,
              companyRoleName: "Senior Buyer",
              customerId: "42",
              companyId: 123,
              channelList: [
                { channelId: 1, channelName: "Main" },
                { channelId: 5, channelName: "Wholesale" },
              ],
            },
          ],
        },
      },
    ]);
    const user = await getUserByEmail(TEST_CTX, "jane@acme.com");
    expect(user).toMatchObject({
      id: 456,
      role: 1,
      customerId: 42,
      companyId: 123,
      companyRoleName: "Senior Buyer",
      channelList: [1, 5],
    });
  });

  it("returns null on a miss", async () => {
    installMockFetch([{ url: "/users?email=", body: { code: 200, data: [] } }]);
    expect(await getUserByEmail(TEST_CTX, "nobody@x.com")).toBeNull();
  });

  it("mapUser handles numeric channelList and missing fields", () => {
    const u = mapUser({ id: 1, email: "a@b.com", role: 2, channelList: [1, 2] });
    expect(u.role).toBe(2);
    expect(u.channelList).toEqual([1, 2]);
    expect(u.firstName).toBe("");
  });
});

describe("company reads", () => {
  it("maps company + approval status", async () => {
    installMockFetch([
      {
        url: "/companies/123",
        body: {
          code: 200,
          data: {
            companyId: 123,
            companyName: "Acme",
            companyStatus: 1,
            bcGroupId: "7",
            priceListAssign: [{ priceListId: 55, channelId: 1 }],
          },
        },
      },
    ]);
    const c = await getCompany(TEST_CTX, 123);
    expect(c?.companyStatus).toBe(1);
    expect(c?.bcGroupId).toBe(7);
    expect(isCompanyApproved(c)).toBe(true);
  });

  it("reads credit config and credit hold", async () => {
    installMockFetch([
      {
        url: "/companies/123/credit",
        body: {
          code: 200,
          data: {
            creditEnabled: true,
            availableCredit: 5000,
            limitPurchases: true,
            creditHold: true,
            creditCurrency: "USD",
          },
        },
      },
    ]);
    const credit = await getCompanyCreditConfig(TEST_CTX, 123);
    expect(credit).toMatchObject({ creditEnabled: true, availableCredit: 5000, limitPurchases: true, creditHold: true });
    expect(await isCompanyOnCreditHold(TEST_CTX, 123)).toBe(true);
  });

  it("reads payment terms", async () => {
    installMockFetch([
      { url: "/companies/123/payment-terms", body: { code: 200, data: { isEnabled: true, paymentTermsDays: 30 } } },
    ]);
    expect(await getCompanyPaymentTerms(TEST_CTX, 123)).toEqual({ isEnabled: true, paymentTermsDays: 30 });
  });

  it("maps addresses and picks defaults (0/1 booleans)", async () => {
    installMockFetch([
      {
        url: "/addresses?companyId=123",
        body: {
          code: 200,
          data: [
            { addressId: 1, addressLine1: "1 A St", isDefaultBilling: 0, isDefaultShipping: 0 },
            { addressId: 2, addressLine1: "2 B St", isDefaultBilling: 1, isDefaultShipping: 1 },
          ],
        },
      },
    ]);
    const addrs = await getCompanyAddresses(TEST_CTX, 123);
    expect(addrs).toHaveLength(2);
    expect(defaultBilling(addrs)?.addressId).toBe(2);
    expect(defaultShipping(addrs)?.addressId).toBe(2);
  });
});
