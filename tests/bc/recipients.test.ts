import { describe, it, expect, afterEach } from "vitest";
import { getCompanySuperAdmins, getCompanyAdmins } from "@/lib/bc/recipients";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("company recipients", () => {
  it("maps super-admins (sales reps) from a { code, data } envelope, filtering bad emails", async () => {
    installMockFetch([
      {
        url: "/companies/123/super-admins",
        body: {
          code: 200,
          data: [
            { id: 1, firstName: "Sam", lastName: "Rep", email: "sam@rep.com" },
            { id: 2, firstName: "No", lastName: "Email", email: "" },
            { id: 3, firstName: "Bad", lastName: "Addr", email: "not-an-email" },
          ],
        },
      },
    ]);
    const reps = await getCompanySuperAdmins(TEST_CTX, 123);
    expect(reps).toEqual([{ email: "sam@rep.com", firstName: "Sam", lastName: "Rep", source: "sales_rep" }]);
  });

  it("maps admins (role 0) from a bare { list } envelope", async () => {
    installMockFetch([
      {
        url: "/users?companyId=123&roles=0",
        body: { list: [{ id: 9, firstName: "Ada", lastName: "Admin", email: "ada@acme.com", role: "0" }] },
      },
    ]);
    const admins = await getCompanyAdmins(TEST_CTX, 123);
    expect(admins).toEqual([{ email: "ada@acme.com", firstName: "Ada", lastName: "Admin", source: "admin" }]);
  });

  it("requests the role filter and returns empty on error", async () => {
    const mock = installMockFetch([{ url: "/users", status: 500, body: { code: 500, message: "boom" } }]);
    const admins = await getCompanyAdmins(TEST_CTX, 77);
    expect(admins).toEqual([]);
    expect(mock.calls[0].url).toContain("roles=0");
    expect(mock.calls[0].url).toContain("companyId=77");
  });
});
