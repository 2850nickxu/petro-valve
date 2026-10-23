import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { magentoAdapter, toResolvedLine } from "@/lib/commerce/magento";
import { resolveCommerce } from "@/lib/commerce";
import { cartLinkConfig, verifyCartLink } from "@/lib/magento/cart-link";
import { clearMagentoTokens } from "@/lib/magento/client";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { heuristicExtract } from "@/lib/po-agent/ai/mock-provider";
import { runSimulatedTurn } from "@/lib/po-agent/rules/conversation";
import { getRulesConfig } from "@/lib/po-agent/rules/config";
import { resolveClassifier } from "@/lib/po-agent/rules/classify";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { createPoStore } from "@/lib/po-agent/store";
import type { Extractor } from "@/lib/po-agent/channel/types";
import type { ExtractedPo, PoLineItem } from "@/lib/po-agent/types";
import type { MagentoProduct } from "@/lib/magento/types";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, type MockRequest, type MockRoute } from "@/tests/helpers/mock-fetch";
import { catalogRoutes, TEST_MAGENTO_CTX, type RawFixtureProduct } from "@/tests/helpers/magento-fixtures";

// The Magento adapter behind the Petro Valve rules flow: PO lines are matched with SKU
// normalization, priced at web pricing, and a quote reply is a guest cart + signed link.
// Magento is mocked; Redis is in memory; the heuristic extractor/classifier keep it offline.

const realFetch = globalThis.fetch;
beforeEach(() => clearMagentoTokens());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CART = "M4sk3dC4rt1d000000000000000000ab";
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

const simple = (id: number, sku: string, price: number, extra: Partial<RawFixtureProduct> = {}): RawFixtureProduct => ({
  id,
  sku,
  name: sku,
  price,
  type_id: "simple",
  status: 1,
  visibility: 1,
  custom_attributes: [
    { attribute_code: "short_description", value: `GATE ${sku}` },
    { attribute_code: "cost", value: "1.00" },
  ],
  ...extra,
});
const CATALOG: RawFixtureProduct[] = [
  simple(11, "VO 12111-1", 135),
  simple(12, "VO 12111-1-1/2", 283),
  simple(13, "VO 12111-3", 0.01),
  simple(21, "ED 848-2", 410),
  simple(22, "CR 848-2", 395),
  { id: 1, sku: "12111", name: "VOGT GATE 800# A105 12111", price: 0, type_id: "configurable", status: 1, visibility: 4 },
];
const CHILDREN = { "12111": [simple(11, "VO 12111-1", 135), simple(13, "VO 12111-3", 0.01)] };

function cartRoutes(opts: { cartPrice?: Record<string, number>; uncharged?: string[] } = {}): MockRoute[] {
  let nextId = 100;
  const added: Array<{ item_id: number; sku: string; qty: number; price: number }> = [];
  return [
    {
      method: "GET",
      url: `/guest-carts/${CART}/totals`,
      body: () => ({
        subtotal: 553,
        grand_total: 553,
        quote_currency_code: "USD",
        items: added.map((a) => ({ ...a, row_total: opts.uncharged?.includes(a.sku) ? 0 : a.qty * a.price })),
      }),
    },
    {
      method: "POST",
      url: `/guest-carts/${CART}/items`,
      body: (req: MockRequest) => {
        const { sku, qty } = (req.body as { cartItem: { sku: string; qty: number } }).cartItem;
        const item = { item_id: nextId++, sku, qty, price: opts.cartPrice?.[sku] ?? CATALOG.find((p) => p.sku === sku)!.price };
        added.push(item);
        return { ...item, name: sku };
      },
    },
    { method: "POST", url: /\/rest\/V1\/guest-carts$/, body: CART },
  ];
}

const config = getPoAgentConfig({ PO_AGENT_COMMERCE: "magento" });
const line = (sku: string | null, quantity: number | null = 1, statedUnitPrice: number | null = null): PoLineItem => ({
  rawText: `${sku} x${quantity}`,
  sku,
  description: null,
  quantity,
  statedUnitPrice,
  statedTotal: null,
});
const product = (over: Partial<MagentoProduct>): MagentoProduct => ({
  id: 11,
  sku: "VO 12111-1",
  name: "VO 12111-1",
  typeId: "simple",
  enabled: true,
  visibility: 1,
  price: 135,
  priceAnomaly: false,
  attributes: { short_description: "GATE 1 800# A105" },
  ...over,
});

describe("toResolvedLine — Magento resolution → what the rules engine reads", () => {
  it("an exact match is priced and named by its short description", () => {
    const r = toResolvedLine(line("VO 12111-1", 2), { status: "matched", input: "VO 12111-1", product: product({}), exact: true }, 1);
    expect(r).toMatchObject({ productId: 11, matchedSku: "VO 12111-1", productName: "GATE 1 800# A105", calculatedUnitPrice: 135, issues: [] });
    expect(r.matchKind).toBeUndefined();
  });
  it("a prefix we added is a recommendation", () => {
    const r = toResolvedLine(line("12111-1"), { status: "matched", input: "12111-1", product: product({}), exact: false }, 1);
    expect(r.matchKind).toBe("recommended");
  });
  it("a $0.01 placeholder carries no price, so it can never be quoted", () => {
    const r = toResolvedLine(line("VO 12111-3"), { status: "matched", input: "VO 12111-3", product: product({ price: 0.01, priceAnomaly: true }), exact: true }, 1);
    expect(r.calculatedUnitPrice).toBeUndefined();
    expect(r.issues).toContain("line_unpriced");
  });
  it("disabled, unresolved, ambiguous and parent lines map to the engine's issues", () => {
    expect(toResolvedLine(line("VO 1"), { status: "matched", input: "VO 1", product: product({ enabled: false }), exact: true }, 1).issues).toContain("line_unresolved");
    expect(toResolvedLine(line("VO 9"), { status: "unresolved", input: "VO 9" }, 1)).toMatchObject({ issues: ["line_unresolved"] });
    const amb = toResolvedLine(line("848-2"), { status: "ambiguous", input: "848-2", candidates: [product({ sku: "ED 848-2", price: 410 }), product({ sku: "CR 848-2", price: 0.01, priceAnomaly: true })] }, 1);
    expect(amb.matchKind).toBe("ambiguous");
    expect(amb.candidates).toEqual([
      { sku: "ED 848-2", name: "GATE 1 800# A105", unitPrice: 410 },
      { sku: "CR 848-2", name: "GATE 1 800# A105", unitPrice: undefined },
    ]);
    const parent = toResolvedLine(
      line("12111"),
      { status: "parent", input: "12111", product: product({ id: 1, sku: "12111", typeId: "configurable", price: 0 }), children: [product({}), product({ id: 13, sku: "VO 12111-3", priceAnomaly: true })], childCount: 2, exact: true },
      1,
    );
    expect(parent).toMatchObject({ parentSku: true, variantChoiceCount: 2, issues: ["line_parent_sku"] });
    expect(parent.variantChoices).toEqual([{ variantId: 11, sku: "VO 12111-1", unitPrice: 135 }, { variantId: 13, sku: "VO 12111-3" }]);
  });
  it("flags a stated price outside the tolerance", () => {
    const r = toResolvedLine(line("VO 12111-1", 1, 100), { status: "matched", input: "VO 12111-1", product: product({}), exact: true }, 1);
    expect(r.issues).toContain("price_mismatch");
  });
});

describe("resolveCommerce", () => {
  it("picks Magento when configured, and says what's missing", () => {
    expect(resolveCommerce(config, {}, null)).toEqual({ error: expect.stringMatching(/Magento/) });
    const ok = resolveCommerce(config, { MAGENTO_BASE_URL: "https://shop.example.com", MAGENTO_ADMIN_USERNAME: "a", MAGENTO_ADMIN_PASSWORD: "b" }, null);
    expect("adapter" in ok && ok.adapter.platform).toBe("magento");
  });
  it("stays on BigCommerce by default", () => {
    expect(resolveCommerce(getPoAgentConfig({}), {}, null)).toEqual({ error: expect.stringMatching(/BigCommerce/) });
  });
});

describe("heuristic extraction reads brand-prefixed SKUs", () => {
  it("VO 12111-1-1/2 and CR 147XU-2 come through whole; prose ranges don't", () => {
    const e = heuristicExtract({ subject: "Quote", bodyText: "SKU: VO 12111-1-1/2 Qty: 3\n4 x CR 147XU-2\nShips in 3-5 days?", extraText: "" });
    expect(e.lines.map((l) => [l.sku, l.quantity])).toEqual([
      ["VO 12111-1-1/2", 3],
      ["CR 147XU-2", 4],
    ]);
  });
});

// ── End to end through the rules flow ───────────────────────────────────────

function setup(opts: { writes?: boolean; linkSecret?: boolean; extract?: Extractor; cart?: Parameters<typeof cartRoutes>[0] } = {}) {
  const http = installMockFetch([...cartRoutes(opts.cart), ...catalogRoutes(CATALOG, CHILDREN)]);
  const ctx = { ...TEST_MAGENTO_CTX, guestCartWrites: opts.writes ?? true };
  const cartLink = opts.linkSecret === false ? null : cartLinkConfig({ MAGENTO_CART_LINK_SECRET: "s3cret" }, ctx.baseUrl);
  const channel = new SimulatorChannel();
  let tick = 0;
  const deps = {
    commerce: magentoAdapter(ctx, { config, cartLink, now: () => NOW }),
    config,
    rules: getRulesConfig({}, { reviewAll: false }),
    store: createPoStore(createMockRedis()),
    channel,
    extract: opts.extract ?? resolveExtractor({}),
    classify: resolveClassifier({}),
    now: () => new Date(NOW + 1000 * tick++).toISOString(),
  };
  let n = 0;
  const send = (body: string, mode: "decide" | "reply" = "reply") => {
    const messageId = `sim-mg-${++n}`;
    return runSimulatedTurn(deps, channel.inject({ from: "buyer@acme-industrial.com", subject: "Quote request", bodyText: body, messageId, threadId: messageId }), { mode });
  };
  return { http, channel, send, cartLink };
}

/** An extractor that returns fixed lines — for buyer spellings the heuristic can't read. */
const fixedLines = (lines: PoLineItem[]): Extractor => async () => ({
  extracted: { poNumber: null, buyerNote: null, paymentIntent: "unspecified", requestedShipDate: null, shipTo: null, billTo: null, lines, currency: null, confidence: "high" } as ExtractedPo,
  notes: [],
});

describe("Magento conversation — reply mode", () => {
  it("quotes a guest at web prices: guest cart created, reply carries the signed cart link", async () => {
    const { http, channel, send, cartLink } = setup();
    const { session, record } = await send("Please quote:\nSKU: VO 12111-1 Qty: 2\nSKU: VO 12111-1-1/2 Qty: 1");

    expect(record.action).toBe("AUTO_RESPOND");
    expect(record.matched_scenarios).toEqual(expect.arrayContaining(["C2", "P1", "Q1"]));
    expect(session.state).toBe("completed_quote");
    expect(session.result?.quoteId).toBe(CART);
    expect(verifyCartLink(cartLink!, record.checkout_url!, NOW)).toBe(CART);

    const adds = http.calls.filter((c) => c.method === "POST" && c.url.endsWith("/items")).map((c) => c.body);
    expect(adds).toEqual([
      { cartItem: { sku: "VO 12111-1", qty: 2, quote_id: CART } },
      { cartItem: { sku: "VO 12111-1-1/2", qty: 1, quote_id: CART } },
    ]);

    const text = channel.sent[0].reply.text;
    expect(text).toContain("VO 12111-1 — GATE VO 12111-1 — 2 × $135.00 = $270.00");
    expect(text).toContain("Total: $553.00");
    expect(text).toContain(record.checkout_url!);
    expect(text).not.toContain("1.00"); // cost never reaches the reply

    const trail = session.audit.map((a) => a.event);
    expect(trail).toEqual(expect.arrayContaining(["identified", "resolved", "priced", "submitted"]));
    expect(session.audit.find((a) => a.event === "identified")?.outcome).toBe("guest");
    expect(session.audit.find((a) => a.event === "submitted")?.summary).toMatch(/Magento guest cart and its signed cart link/);
  });

  it("escalates a $0.01 placeholder and creates nothing", async () => {
    const { http, channel, send } = setup();
    const { record } = await send("Please quote:\nSKU: VO 12111-3 Qty: 1");
    expect(record.action).toBe("ESCALATE");
    expect(record.matched_scenarios).toContain("Q5");
    expect(http.calls.some((c) => c.url.includes("/guest-carts"))).toBe(false);
    expect(channel.sent).toHaveLength(0);
  });

  it("with guest-cart writes off, a quote can't be created, so the request goes to a person (T14)", async () => {
    const { http, send } = setup({ writes: false });
    const { record } = await send("Please quote:\nSKU: VO 12111-1 Qty: 2");
    expect(record.action).toBe("ESCALATE");
    expect(record.matched_scenarios).toContain("T14");
    expect(http.calls.some((c) => c.url.includes("/guest-carts"))).toBe(false);
  });

  it("never sends a cart that won't charge a line: the request goes to a person (T14)", async () => {
    const { channel, send } = setup({ cart: { uncharged: ["VO 12111-1-1/2"] } });
    const { session, record } = await send("Please quote:\nSKU: VO 12111-1 Qty: 2\nSKU: VO 12111-1-1/2 Qty: 1");
    expect(record.action).toBe("ESCALATE");
    expect(record.matched_scenarios).toContain("T14");
    expect(channel.sent).toHaveLength(0);
    expect(session.audit.find((a) => a.event === "submitted")?.summary).toContain("won't charge VO 12111-1-1/2");
  });

  it("never quotes catalog prices for a cart Magento repriced (T14)", async () => {
    const { channel, send } = setup({ cart: { cartPrice: { "VO 12111-1": 89.59 } } });
    const { session, record } = await send("Please quote:\nSKU: VO 12111-1 Qty: 2");
    expect(record.action).toBe("ESCALATE");
    expect(channel.sent).toHaveLength(0);
    expect(session.audit.find((a) => a.event === "submitted")?.summary).toContain("catalog $135.00 vs cart $89.59");
  });

  it("asks the customer to confirm a recommendation when the prefix was missing (P4)", async () => {
    const { channel, send } = setup({ extract: fixedLines([line("12111-1", 2)]) });
    const { record } = await send("Please quote:\nSKU: 12111-1 Qty: 2");
    expect(record.action).toBe("CLARIFY");
    expect(record.matched_scenarios).toContain("P4");
    expect(channel.sent[0].reply.text).toContain("Our closest match is VO 12111-1 (GATE VO 12111-1) at $135.00 each");
  });

  it("asks which brand when several carry the number (P5)", async () => {
    const { channel, send } = setup({ extract: fixedLines([line("848-2", 1)]) });
    const { record } = await send("Please quote:\nSKU: 848-2 Qty: 1");
    expect(record.action).toBe("CLARIFY");
    expect(record.matched_scenarios).toContain("P5");
    expect(channel.sent[0].reply.text).toMatch(/matches several products: (ED|CR) 848-2 \(\$\d+\.00 each\), (ED|CR) 848-2/);
  });

  it("a parent SKU needs a size, so it escalates (P14)", async () => {
    const { send } = setup({ extract: fixedLines([line("12111", 1)]) });
    const { record } = await send("Please quote:\nSKU: 12111 Qty: 1");
    expect(record.action).toBe("ESCALATE");
    expect(record.matched_scenarios).toContain("P14");
  });
});

describe("Magento conversation — decide only", () => {
  it("previews the quote and writes nothing", async () => {
    const { http, send } = setup();
    const { record } = await send("Please quote:\nSKU: VO 12111-1 Qty: 2", "decide");
    expect(record.action).toBe("AUTO_RESPOND");
    expect(record.reply?.body).toContain("[the checkout link is created when this reply is sent]");
    expect(http.calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["https://shop.example.com/rest/V1/integration/admin/token"]);
  });
});
