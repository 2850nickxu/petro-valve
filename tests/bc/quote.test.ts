import { describe, it, expect, afterEach } from "vitest";
import {
  quoteAudience,
  isQuoteAllowed,
  isQuoteAllowedOnProduct,
  isQuoteAllowedOnCart,
  type QuoteConfig,
} from "@/lib/bc/quote-gate";
import { mapQuoteConfig, getQuoteConfigs } from "@/lib/bc/quote-config";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const cfg = (o: Partial<QuoteConfig> = {}): QuoteConfig => ({
  featureEnabled: true,
  allowGuest: true,
  allowIndividual: true,
  allowCompany: true,
  onProductPage: true,
  onCartPage: true,
  defaultExpirationDays: 30,
  ...o,
});

describe("quote-gate predicates", () => {
  it("classifies audience", () => {
    expect(quoteAudience(null)).toBe("guest");
    expect(quoteAudience({})).toBe("individual");
    expect(quoteAudience({ b2bCompanyId: 5 })).toBe("company");
  });

  it("gates on featureEnabled and per-audience toggles", () => {
    expect(isQuoteAllowed(cfg(), "company")).toBe(true);
    expect(isQuoteAllowed(cfg({ featureEnabled: false }), "company")).toBe(false);
    expect(isQuoteAllowed(cfg({ allowCompany: false }), "company")).toBe(false);
    expect(isQuoteAllowed(cfg({ allowGuest: false }), "guest")).toBe(false);
  });

  it("adds surface gates", () => {
    expect(isQuoteAllowedOnProduct(cfg({ onProductPage: false }), "company")).toBe(false);
    expect(isQuoteAllowedOnCart(cfg({ onCartPage: false }), "company")).toBe(false);
  });
});

describe("mapQuoteConfig shapes", () => {
  it("maps an array-of-{key,value}", () => {
    const c = mapQuoteConfig([
      { key: "quote_customer", value: "1" },
      { key: "quote_for_guest", value: "0" },
      { key: "quote_for_b2b", value: true },
      { key: "defaultExpirationDate", value: 45 },
    ]);
    expect(c.featureEnabled).toBe(true);
    expect(c.allowGuest).toBe(false);
    expect(c.allowCompany).toBe(true);
    expect(c.defaultExpirationDays).toBe(45);
  });

  it("maps a keyed object", () => {
    const c = mapQuoteConfig({ quote_customer: false });
    expect(c.featureEnabled).toBe(false);
  });
});

describe("getQuoteConfigs", () => {
  it("returns the safe fallback on a non-200", async () => {
    installMockFetch([{ url: "/api/v2/rfq/configs", status: 500, body: {} }]);
    const c = await getQuoteConfigs(TEST_CTX);
    expect(c.featureEnabled).toBe(true);
    expect(c.allowGuest).toBe(false); // guests closed by default
  });
});
