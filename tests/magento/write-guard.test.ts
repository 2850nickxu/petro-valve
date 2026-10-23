import { describe, it, expect, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { GUEST_CART_WRITE_PATHS, magentoGuestCartGet, magentoGuestCartPost } from "@/lib/magento/client";
import { installMockFetch } from "@/tests/helpers/mock-fetch";
import { TEST_MAGENTO_CTX } from "@/tests/helpers/magento-fixtures";

// Petro Valve's production Magento store is read-only for this app except for exactly two
// guest-cart writes: create a guest cart, add an item to it. This guard fails the build if
// lib/magento gains any other write — customer carts, catalog, orders, PUT, DELETE.

const DIR = path.resolve(__dirname, "../../lib/magento");
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(path.join(DIR, f), "utf8") }));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const WRITES_ON = { ...TEST_MAGENTO_CTX, guestCartWrites: true };
const CART = "a".repeat(32);

describe("lib/magento write guard — source", () => {
  it("only client.ts calls fetch", () => {
    expect(sources.filter((s) => /\bfetch\s*\(/.test(s.text)).map((s) => s.file)).toEqual(["client.ts"]);
  });

  it("never names PUT, PATCH or DELETE", () => {
    const hits = sources.filter((s) => /["'`](PUT|PATCH|DELETE)["'`]/.test(s.text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it("the only POST literal is the admin-token login", () => {
    const client = sources.find((s) => s.file === "client.ts")!.text;
    const posts = sources.flatMap((s) => [...s.text.matchAll(/method:\s*["'`]POST["'`]/g)].map(() => s.file));
    expect(posts).toEqual(["client.ts"]);
    const at = client.indexOf('method: "POST"');
    expect(client.slice(client.lastIndexOf("async function login(", at), at)).toContain("/integration/admin/token");
  });

  it("no customer-cart or /carts/mine route appears anywhere", () => {
    const hits = sources.filter((s) => /\/customers\/[^"'`\s]*\/carts|\/carts\/mine/.test(s.text.replace(/\/\/.*$/gm, "")));
    expect(hits.map((s) => s.file)).toEqual([]);
  });

  it("exports exactly one write helper", () => {
    const exported = sources.flatMap((s) => [...s.text.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]));
    expect(exported.filter((n) => /^magento\w*(Post|Put|Patch|Delete|Fetch|Request)$/i.test(n))).toEqual(["magentoGuestCartPost"]);
  });

  it("allows exactly two write paths", () => {
    expect(GUEST_CART_WRITE_PATHS).toHaveLength(2);
  });
});

describe("magentoGuestCartPost — runtime", () => {
  it("is off unless guestCartWrites is set, and sends nothing", async () => {
    const mock = installMockFetch([]);
    await expect(magentoGuestCartPost(TEST_MAGENTO_CTX, "/guest-carts")).rejects.toThrow(/disabled/);
    expect(mock.calls).toHaveLength(0);
  });

  it.each([
    "/carts/mine",
    "/customers/5/carts",
    "/carts",
    "/products",
    "/orders",
    `/guest-carts/${CART}/billing-address`,
    `/guest-carts/${CART}/shipping-information`,
    `/guest-carts/${CART}/payment-information`,
    `/guest-carts/${CART}/order`,
    `/guest-carts/${CART}/items/5`,
    "/guest-carts/short/items",
    `/guest-carts/${CART}/items?x=1`,
    `/guest-carts/../carts/items`,
  ])("rejects %s even with writes on, before any request", async (p) => {
    const mock = installMockFetch([]);
    await expect(magentoGuestCartPost(WRITES_ON, p)).rejects.toThrow(/not an allowed guest-cart write/);
    expect(mock.calls).toHaveLength(0);
  });

  it("sends the allowed writes anonymously (no admin token)", async () => {
    const mock = installMockFetch([
      { method: "POST", url: `/guest-carts/${CART}/items`, body: { item_id: 1 } },
      { method: "POST", url: "/rest/V1/guest-carts", body: CART },
    ]);
    await magentoGuestCartPost(WRITES_ON, "/guest-carts");
    await magentoGuestCartPost(WRITES_ON, `/guest-carts/${CART}/items`, { cartItem: { sku: "X 1", qty: 1, quote_id: CART } });
    expect(mock.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://shop.example.com/rest/V1/guest-carts",
      `POST https://shop.example.com/rest/V1/guest-carts/${CART}/items`,
    ]);
    expect(mock.calls.every((c) => !("authorization" in c.headers))).toBe(true);
  });

  it("guest-cart reads are limited to the cart, its items and its totals", async () => {
    await expect(magentoGuestCartGet(TEST_MAGENTO_CTX, "/carts/mine")).rejects.toThrow(/not a guest-cart read/);
    await expect(magentoGuestCartGet(TEST_MAGENTO_CTX, `/guest-carts/${CART}/payment-methods`)).rejects.toThrow();
  });
});
