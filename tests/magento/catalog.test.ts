import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { clearMagentoTokens } from "@/lib/magento/client";
import { getProductBySku, getProductsBySkus, plainText, searchProductsBySkuLike } from "@/lib/magento/catalog";
import { resolveSkus } from "@/lib/magento/sku-resolver";
import { installMockFetch } from "@/tests/helpers/mock-fetch";
import { catalogRoutes, TEST_MAGENTO_CTX, type RawFixtureProduct } from "@/tests/helpers/magento-fixtures";

const realFetch = globalThis.fetch;
beforeEach(() => clearMagentoTokens());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const variant = (sku: string, price: number, extra: Partial<RawFixtureProduct> = {}): RawFixtureProduct => ({
  sku,
  name: sku,
  price,
  type_id: "simple",
  status: 1,
  visibility: 1,
  ...extra,
});

const CATALOG: RawFixtureProduct[] = [
  variant("VO 12111-1", 135, {
    custom_attributes: [
      { attribute_code: "cost", value: "61.20" },
      { attribute_code: "short_description", value: "GATE 1 800# A105 THD BB OS&Y" },
      { attribute_code: "ecc_brand", value: "Vogt" },
      { attribute_code: "hub_product_id", value: "998877" },
    ],
  }),
  variant("VO 12111-1-1/2", 283),
  variant("VO 12111-3", 0.01),
  variant("ED 848-2", 410),
  variant("CR 848-2", 395),
  variant("CR 147XU-2", 1687, { status: 2 }),
  { sku: "12111", name: "VOGT GATE 800# A105 12111", price: 0, type_id: "configurable", status: 1, visibility: 4 },
];
const CHILDREN = { "12111": [variant("VO 12111-1", 135), variant("VO 12111-1-1/2", 283), variant("VO 12111-3", 0.01)] };

describe("getProductsBySkus", () => {
  it("asks only for the base fields by default — custom_attributes (and so cost) are never requested", async () => {
    const mock = installMockFetch(catalogRoutes(CATALOG));
    const found = await getProductsBySkus(TEST_MAGENTO_CTX, ["VO 12111-1", "VO 12111-1-1/2", "NOPE 1"]);
    expect([...found.keys()]).toEqual(["VO 12111-1", "VO 12111-1-1/2"]);
    expect(found.get("VO 12111-1")).toEqual({
      id: 0,
      sku: "VO 12111-1",
      name: "VO 12111-1",
      typeId: "simple",
      enabled: true,
      visibility: 1,
      price: 135,
      priceAnomaly: false,
    });
    const fields = new URL(mock.callsTo("/rest/V1/products?")[0].url).searchParams.get("fields");
    expect(fields).toBe("items[id,sku,name,price,type_id,status,visibility],total_count");
  });

  it("withAttributes keeps allow-listed attributes and drops cost and everything else", async () => {
    installMockFetch(catalogRoutes(CATALOG));
    const p = await getProductBySku(TEST_MAGENTO_CTX, "VO 12111-1", { withAttributes: true });
    expect(p?.attributes).toEqual({ short_description: "GATE 1 800# A105 THD BB OS&Y", ecc_brand: "Vogt" });
    expect(JSON.stringify(p)).not.toContain("61.20");
  });

  it("flags $0.01 placeholders and disabled items; a configurable parent's 0 is not an anomaly", async () => {
    installMockFetch(catalogRoutes(CATALOG));
    const found = await getProductsBySkus(TEST_MAGENTO_CTX, ["VO 12111-3", "CR 147XU-2", "12111"]);
    expect(found.get("VO 12111-3")?.priceAnomaly).toBe(true);
    expect(found.get("CR 147XU-2")?.enabled).toBe(false);
    expect(found.get("12111")).toMatchObject({ typeId: "configurable", priceAnomaly: false });
  });

  it("batches large lookups into several GETs", async () => {
    const mock = installMockFetch(catalogRoutes(CATALOG));
    await getProductsBySkus(TEST_MAGENTO_CTX, Array.from({ length: 120 }, (_, i) => `XX ${i}`));
    expect(mock.callsTo("/rest/V1/products?")).toHaveLength(3);
    expect(mock.calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual([
      "https://shop.example.com/rest/V1/integration/admin/token",
    ]);
  });
});

describe("plainText", () => {
  it("strips page HTML and embedded video from description attributes", () => {
    expect(
      plainText('<p>GATE 800# A105 THD BB OS&amp;Y</p>\n<p><iframe width="400" src="https://www.youtube.com/embed/x"></iframe></p>'),
    ).toBe("GATE 800# A105 THD BB OS&Y");
  });
});

describe("searchProductsBySkuLike", () => {
  it("wraps the fragment in %…% and strips caller-supplied wildcards", async () => {
    const mock = installMockFetch(catalogRoutes(CATALOG));
    const res = await searchProductsBySkuLike(TEST_MAGENTO_CTX, "12111_1%");
    const value = new URL(mock.calls[1].url).searchParams.get("searchCriteria[filterGroups][0][filters][0][value]");
    expect(value).toBe("%121111%");
    expect(res.total).toBe(0);
    expect(await searchProductsBySkuLike(TEST_MAGENTO_CTX, "%%")).toEqual({ items: [], total: 0 });
  });
});

describe("resolveSkus", () => {
  it("resolves every outcome from one batched lookup", async () => {
    const mock = installMockFetch(catalogRoutes(CATALOG, CHILDREN));
    const out = await resolveSkus(TEST_MAGENTO_CTX, [
      "vo 12111 - 1 1/2\"", // exact after normalization
      "12111-1", // no prefix: only Vogt has it → recommendation
      "848-2", // no prefix: Edward and Crane both have it
      "12111", // configurable parent
      "VO 99999-1", // not in catalog
    ]);

    expect(out.get('vo 12111 - 1 1/2"')).toMatchObject({ status: "matched", exact: true, product: { sku: "VO 12111-1-1/2", price: 283 } });
    expect(out.get("12111-1")).toMatchObject({ status: "matched", exact: false, product: { sku: "VO 12111-1" } });
    const amb = out.get("848-2");
    expect(amb?.status).toBe("ambiguous");
    expect(amb?.status === "ambiguous" && amb.candidates.map((c) => c.sku).sort()).toEqual(["CR 848-2", "ED 848-2"]);
    const parent = out.get("12111");
    expect(parent).toMatchObject({ status: "parent", exact: true, childCount: 3 });
    expect(parent?.status === "parent" && parent.children.find((c) => c.sku === "VO 12111-3")?.priceAnomaly).toBe(true);
    expect(out.get("VO 99999-1")).toEqual({ status: "unresolved", input: "VO 99999-1" });

    expect(mock.callsTo("/rest/V1/products?")).toHaveLength(1);
    expect(mock.callsTo("/configurable-products/12111/children")).toHaveLength(1);
  });

  it("does nothing for empty input", async () => {
    const mock = installMockFetch(catalogRoutes(CATALOG));
    expect((await resolveSkus(TEST_MAGENTO_CTX, ["", "  "])).size).toBe(0);
    expect(mock.calls).toHaveLength(0);
  });
});
