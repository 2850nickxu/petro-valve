import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { clearMagentoTokens } from "@/lib/magento/client";
import { buildGuestCart, CartPreflightError, GuestCartBuildError } from "@/lib/magento/carts";
import { installMockFetch, type MockRequest, type MockRoute } from "@/tests/helpers/mock-fetch";
import { catalogRoutes, TEST_MAGENTO_CTX, type RawFixtureProduct } from "@/tests/helpers/magento-fixtures";

const realFetch = globalThis.fetch;
beforeEach(() => clearMagentoTokens());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const WRITES_ON = { ...TEST_MAGENTO_CTX, guestCartWrites: true };
const CART = "M4sk3dC4rt1d000000000000000000ab";

const simple = (sku: string, price: number, extra: Partial<RawFixtureProduct> = {}): RawFixtureProduct => ({
  sku,
  name: sku,
  price,
  type_id: "simple",
  status: 1,
  visibility: 1,
  ...extra,
});
const CATALOG = [
  simple("VO 12111-1", 135),
  simple("VO 12111-1-1/2", 283),
  simple("VO 12111-3", 0.01),
  simple("CR 147XU-2", 1687, { status: 2 }),
  { sku: "12111", name: "VOGT GATE", price: 0, type_id: "configurable", status: 1, visibility: 4 },
];

/** Guest-cart routes; `cartPrice` lets a test simulate Epicor repricing a line. */
function cartRoutes(opts: { cartPrice?: Record<string, number>; uncharged?: number[] } = {}): MockRoute[] {
  let nextId = 100;
  return [
    {
      method: "GET",
      url: `/guest-carts/${CART}/totals`,
      body: {
        subtotal: 553,
        grand_total: 553,
        quote_currency_code: "USD",
        items: [
          { item_id: 100, name: "VO 12111-1", qty: 2, price: 135, row_total: opts.uncharged?.includes(100) ? 0 : 270 },
          { item_id: 101, name: "VO 12111-1-1/2", qty: 1, price: 283, row_total: opts.uncharged?.includes(101) ? 0 : 283 },
        ],
      },
    },
    {
      method: "POST",
      url: `/guest-carts/${CART}/items`,
      body: (req: MockRequest) => {
        const { sku, qty } = (req.body as { cartItem: { sku: string; qty: number } }).cartItem;
        const price = opts.cartPrice?.[sku] ?? CATALOG.find((p) => p.sku === sku)!.price;
        return { item_id: nextId++, sku, qty, name: sku, price, quote_id: CART };
      },
    },
    { method: "POST", url: /\/rest\/V1\/guest-carts$/, body: CART },
  ];
}

/** Make Magento reject adding one SKU (e.g. out of stock) after the cart exists. */
function failAdding(sku: string) {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (init.method === "POST" && url.endsWith("/items") && String(init.body).includes(`"sku":"${sku}"`)) {
      const body = { message: "The requested qty is not available" };
      return { ok: false, status: 400, json: async () => body, text: async () => JSON.stringify(body) } as Response;
    }
    return inner(url, init);
  }) as typeof fetch;
}

describe("buildGuestCart", () => {
  it("refuses outright when writes are off — not even a read goes out", async () => {
    const mock = installMockFetch([]);
    await expect(buildGuestCart(TEST_MAGENTO_CTX, [{ sku: "VO 12111-1", qty: 1 }])).rejects.toThrow(/disabled/);
    expect(mock.calls).toHaveLength(0);
  });

  it("creates the cart, adds merged lines with only sku/qty/quote_id, and reads totals", async () => {
    const mock = installMockFetch([...cartRoutes(), ...catalogRoutes(CATALOG)]);
    const cart = await buildGuestCart(WRITES_ON, [
      { sku: "VO 12111-1", qty: 1 },
      { sku: "VO 12111-1-1/2", qty: 1 },
      { sku: "vo 12111-1", qty: 1 },
    ]);

    expect(cart.maskedId).toBe(CART);
    expect(cart.items.map((i) => [i.sku, i.qty])).toEqual([
      ["VO 12111-1", 2],
      ["VO 12111-1-1/2", 1],
    ]);
    expect(cart.totals).toMatchObject({ grandTotal: 553, currency: "USD" });
    expect(cart.priceMismatches).toEqual([]);
    expect(cart.excludedItems).toEqual([]);

    const adds = mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/items"));
    expect(adds.map((c) => c.body)).toEqual([
      { cartItem: { sku: "VO 12111-1", qty: 2, quote_id: CART } },
      { cartItem: { sku: "VO 12111-1-1/2", qty: 1, quote_id: CART } },
    ]);
    const writes = mock.calls.filter((c) => c.method !== "GET");
    expect(writes.every((c) => !JSON.stringify(c.body ?? "").includes("email"))).toBe(true);
    expect(writes.map((c) => c.url.replace("https://shop.example.com/rest/V1", ""))).toEqual([
      "/integration/admin/token", // catalog preflight login
      "/guest-carts",
      `/guest-carts/${CART}/items`,
      `/guest-carts/${CART}/items`,
    ]);
  });

  it("reports lines Magento accepted but left out of the totals (row total 0)", async () => {
    installMockFetch([...cartRoutes({ uncharged: [101] }), ...catalogRoutes(CATALOG)]);
    const cart = await buildGuestCart(WRITES_ON, [
      { sku: "VO 12111-1", qty: 2 },
      { sku: "VO 12111-1-1/2", qty: 1 },
    ]);
    expect(cart.excludedItems).toEqual([{ sku: "VO 12111-1-1/2", qty: 1 }]);
  });

  it("reports cart prices that differ from the catalog (Epicor repricing)", async () => {
    installMockFetch([...cartRoutes({ cartPrice: { "VO 12111-1": 129.5 } }), ...catalogRoutes(CATALOG)]);
    const cart = await buildGuestCart(WRITES_ON, [{ sku: "VO 12111-1", qty: 1 }]);
    expect(cart.priceMismatches).toEqual([{ sku: "VO 12111-1", catalogPrice: 135, cartPrice: 129.5 }]);
  });

  it("preflight rejects the whole cart — and writes nothing — when any line is unfit", async () => {
    const mock = installMockFetch([...cartRoutes(), ...catalogRoutes(CATALOG)]);
    const err = await buildGuestCart(WRITES_ON, [
      { sku: "VO 12111-1", qty: 1 },
      { sku: "VO 99999-9", qty: 1 },
      { sku: "12111", qty: 1 },
      { sku: "CR 147XU-2", qty: 1 },
      { sku: "VO 12111-3", qty: 1 },
      { sku: "VO 12111-1-1/2", qty: 0.5 },
    ]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CartPreflightError);
    expect((err as CartPreflightError).problems).toEqual([
      { sku: "VO 99999-9", reason: "not_found" },
      { sku: "12111", reason: "not_purchasable" },
      { sku: "CR 147XU-2", reason: "disabled" },
      { sku: "VO 12111-3", reason: "price_anomaly" },
      { sku: "VO 12111-1-1/2", reason: "bad_quantity" },
    ]);
    expect(mock.calls.filter((c) => c.url.includes("/guest-carts"))).toHaveLength(0);
  });

  it("a failed add after creation reports the cart id and what was added", async () => {
    installMockFetch([...cartRoutes(), ...catalogRoutes(CATALOG)]);
    failAdding("VO 12111-1-1/2");
    const err = await buildGuestCart(WRITES_ON, [
      { sku: "VO 12111-1", qty: 1 },
      { sku: "VO 12111-1-1/2", qty: 1 },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuestCartBuildError);
    expect((err as GuestCartBuildError).maskedId).toBe(CART);
    expect((err as GuestCartBuildError).added.map((i) => i.sku)).toEqual(["VO 12111-1"]);
    expect(String(err)).toMatch(/400/);
  });
});
