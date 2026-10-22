import { describe, it, expect, beforeAll } from "vitest";
import { getMagentoContext, type MagentoContext } from "@/lib/magento/magento-context";
import { magentoGet } from "@/lib/magento/client";
import { getProductBySku, searchProductsBySkuLike } from "@/lib/magento/catalog";
import { resolveSkus } from "@/lib/magento/sku-resolver";

// ─────────────────────────────────────────────────────────────────────────────
// [LM] LIVE Magento read verification (Petro Valve production store).
//
// SKIPPED unless PO_AGENT_LIVE=1 and the MAGENTO_* context is present, so `npm test` stays
// credential-free and offline. READ-ONLY: GETs plus one admin-token login — it never
// creates a cart or changes catalog/customer data.
//
//   PO_AGENT_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/live/magento-read.test.ts
//
// Fixtures are pinned to prod as of 2026-10-22 (VO 12111-3 carries a $0.01 placeholder).
// Prices are not pinned — they change; only their shape is asserted.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE =
  process.env.PO_AGENT_LIVE === "1" &&
  Boolean(process.env.MAGENTO_BASE_URL && process.env.MAGENTO_ADMIN_USERNAME && process.env.MAGENTO_ADMIN_PASSWORD);

describe.skipIf(!LIVE)("[LM] live Magento — read-only", () => {
  let ctx: MagentoContext;
  beforeAll(() => {
    ctx = getMagentoContext();
  });

  it("authenticates and reads store views", async () => {
    const views = await magentoGet<Array<{ code: string }>>(ctx, "/store/storeViews");
    expect(views.map((v) => v.code)).toContain("default");
  });

  it("resolves buyer spellings, prefix-less SKUs, parents, placeholders and misses", async () => {
    const out = await resolveSkus(ctx, ["VO 12111-1", 'vo 12111 1 1/2"', "12111-1", "VO 12111-3", "12111", "VO 99999-9"]);

    const exact = out.get("VO 12111-1");
    expect(exact).toMatchObject({ status: "matched", exact: true, product: { typeId: "simple", priceAnomaly: false } });
    expect(exact?.status === "matched" && exact.product.price).toBeGreaterThan(0.01);
    expect(out.get('vo 12111 1 1/2"')).toMatchObject({ status: "matched", product: { sku: "VO 12111-1-1/2" } });
    expect(out.get("12111-1")).toMatchObject({ product: { sku: "VO 12111-1" }, exact: false });
    expect(out.get("VO 12111-3")).toMatchObject({ status: "matched", product: { priceAnomaly: true } });
    const parent = out.get("12111");
    expect(parent).toMatchObject({ status: "parent", product: { typeId: "configurable" } });
    // Children are Vogt sizes of 12111 — including an "L" model variant (VO L12111-1-1/2).
    expect(parent?.status === "parent" && parent.children.every((c) => /^VO L?12111-/.test(c.sku))).toBe(true);
    expect(out.get("VO 99999-9")?.status).toBe("unresolved");
  });

  it("returns allow-listed attributes and never cost", async () => {
    const p = await getProductBySku(ctx, "VO 12111-1", { withAttributes: true });
    expect(p?.attributes?.ecc_brand).toBe("Vogt");
    expect(Object.keys(p?.attributes ?? {})).not.toContain("cost");
  });

  it("partial-SKU search returns suggestions", async () => {
    const res = await searchProductsBySkuLike(ctx, "12111-1", { typeId: "simple", limit: 5 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.every((i) => i.sku.includes("12111-1"))).toBe(true);
  });
});
