import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { clearMagentoTokens, magentoGet, MagentoApiError, searchQuery } from "@/lib/magento/client";
import { getMagentoContext, tryGetMagentoContext } from "@/lib/magento/magento-context";
import { installMockFetch } from "@/tests/helpers/mock-fetch";
import { TEST_MAGENTO_CTX, tokenRoute } from "@/tests/helpers/magento-fixtures";

const realFetch = globalThis.fetch;
beforeEach(() => clearMagentoTokens());
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch whose GETs answer with the given statuses in order (then 200), counting logins. */
function scriptedFetch(getStatuses: number[], loginStatus = 200) {
  const log = { logins: 0, gets: [] as Array<{ url: string; auth: string }> };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string>;
    if (init.method === "POST") {
      log.logins++;
      const body = loginStatus === 200 ? `tok-${log.logins}` : { message: "The account sign-in was incorrect." };
      return { ok: loginStatus === 200, status: loginStatus, json: async () => body, text: async () => JSON.stringify(body) };
    }
    log.gets.push({ url, auth: headers.Authorization });
    const status = getStatuses.shift() ?? 200;
    const body = status === 200 ? { ok: true } : { message: "The consumer isn't authorized to access %resources." };
    return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return log;
}

describe("getMagentoContext", () => {
  const env = { MAGENTO_BASE_URL: "https://petrovalve.com/", MAGENTO_ADMIN_USERNAME: " agent ", MAGENTO_ADMIN_PASSWORD: "pw" };

  it("reads env, trims the username and the trailing slash", () => {
    expect(getMagentoContext(env)).toEqual({
      baseUrl: "https://petrovalve.com",
      username: "agent",
      password: "pw",
      guestCartWrites: false,
    });
  });
  it("guest-cart writes are on only for an explicit MAGENTO_GUEST_CART_WRITES=true", () => {
    expect(getMagentoContext({ ...env, MAGENTO_GUEST_CART_WRITES: "true" }).guestCartWrites).toBe(true);
    expect(getMagentoContext({ ...env, MAGENTO_GUEST_CART_WRITES: "1" }).guestCartWrites).toBe(false);
  });
  it("throws when anything is missing; the try-variant returns null", () => {
    expect(() => getMagentoContext({ ...env, MAGENTO_ADMIN_PASSWORD: "" })).toThrow(/not configured/);
    expect(tryGetMagentoContext({})).toBeNull();
  });
  it("refuses a non-https origin", () => {
    expect(() => getMagentoContext({ ...env, MAGENTO_BASE_URL: "http://petrovalve.com" })).toThrow(/https/);
  });
});

describe("magentoGet auth + URL shaping", () => {
  it("logs in once, sends the bearer token to /rest/V1, and reuses the token", async () => {
    const mock = installMockFetch([tokenRoute, { method: "GET", url: "/rest/V1/store/storeViews", body: [{ id: 1 }] }]);
    expect(await magentoGet(TEST_MAGENTO_CTX, "/store/storeViews")).toEqual([{ id: 1 }]);
    await magentoGet(TEST_MAGENTO_CTX, "/store/storeViews");

    const logins = mock.callsTo("/integration/admin/token");
    expect(logins).toHaveLength(1);
    expect(logins[0].body).toEqual({ username: "agent", password: "secret-pw" });
    const gets = mock.callsTo("/store/storeViews");
    expect(gets[0].url).toBe("https://shop.example.com/rest/V1/store/storeViews");
    expect(gets[0].method).toBe("GET");
    expect(gets[1].headers.authorization).toBe("Bearer test-token");
  });

  it("shares one login between concurrent callers", async () => {
    const log = scriptedFetch([]);
    await Promise.all([1, 2, 3].map(() => magentoGet(TEST_MAGENTO_CTX, "/store/storeViews")));
    expect(log.logins).toBe(1);
  });

  it("re-logs in once on a 401 and retries with the new token", async () => {
    const log = scriptedFetch([401]);
    expect(await magentoGet(TEST_MAGENTO_CTX, "/products")).toEqual({ ok: true });
    expect(log.logins).toBe(2);
    expect(log.gets.map((g) => g.auth)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("gives up after a second 401", async () => {
    const log = scriptedFetch([401, 401]);
    await expect(magentoGet(TEST_MAGENTO_CTX, "/products")).rejects.toMatchObject({ name: "MagentoApiError", status: 401 });
    expect(log.logins).toBe(2);
  });

  it("does not retry a failed login, and the failure does not stick in the cache", async () => {
    let log = scriptedFetch([], 401);
    await expect(magentoGet(TEST_MAGENTO_CTX, "/products")).rejects.toBeInstanceOf(MagentoApiError);
    expect(log.logins).toBe(1);
    expect(log.gets).toHaveLength(0);

    log = scriptedFetch([]);
    await magentoGet(TEST_MAGENTO_CTX, "/products");
    expect(log.logins).toBe(1);
  });

  it("never puts the password in an error message", async () => {
    scriptedFetch([], 401);
    const err = await magentoGet(TEST_MAGENTO_CTX, "/products").catch((e: Error) => e);
    expect(String(err)).not.toContain("secret-pw");
  });

  it("rejects absolute URLs so the token can't be sent elsewhere", async () => {
    await expect(magentoGet(TEST_MAGENTO_CTX, "https://evil.example.com/x")).rejects.toThrow(/relative/);
  });
});

describe("searchQuery", () => {
  it("builds one AND-ed filterGroup per filter with encoded values and fields", () => {
    const q = new URLSearchParams(
      searchQuery([["sku", "VO 12111-1-1/2,CR 147XU-2", "in"], ["type_id", "simple"]], {
        pageSize: 2,
        fields: "items[sku,price],total_count",
      }),
    );
    expect(q.get("searchCriteria[filterGroups][0][filters][0][value]")).toBe("VO 12111-1-1/2,CR 147XU-2");
    expect(q.get("searchCriteria[filterGroups][0][filters][0][conditionType]")).toBe("in");
    expect(q.get("searchCriteria[filterGroups][1][filters][0][field]")).toBe("type_id");
    expect(q.has("searchCriteria[filterGroups][1][filters][0][conditionType]")).toBe(false);
    expect(q.get("searchCriteria[pageSize]")).toBe("2");
    expect(q.get("fields")).toBe("items[sku,price],total_count");
  });
});
