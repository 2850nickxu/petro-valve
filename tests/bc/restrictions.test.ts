import { describe, it, expect } from "vitest";
import {
  resolveEntitlements,
  isProductVisible,
  findBlockedProductIds,
  parseCodeList,
  catalogRestrictionsEnabled,
  type Entitlements,
} from "@/lib/bc/restrictions";
import type { B2BCompany } from "@/lib/bc/types";

const company = (codes?: string): B2BCompany => ({
  companyId: 1,
  companyName: "Acme",
  companyStatus: 1,
  extraFields: codes != null ? [{ fieldName: "Assortment Codes", fieldValue: codes }] : [],
});

describe("catalogRestrictionsEnabled", () => {
  it("is off unless CATALOG_RESTRICTIONS=assortments", () => {
    expect(catalogRestrictionsEnabled({})).toBe(false);
    expect(catalogRestrictionsEnabled({ CATALOG_RESTRICTIONS: "assortments" })).toBe(true);
  });
});

describe("parseCodeList", () => {
  it("parses json array, csv, spaces, and the all sentinel", () => {
    expect(parseCodeList('["A","B"]')).toEqual(["a", "b"]);
    expect(parseCodeList("A, b ,C")).toEqual(["a", "b", "c"]);
    expect(parseCodeList("all")).toBe("all");
    expect(parseCodeList("")).toBeNull();
    expect(parseCodeList(null)).toBeNull();
  });
});

describe("resolveEntitlements", () => {
  const env = { CATALOG_RESTRICTIONS: "assortments" };
  it("is open when the feature is off (regardless of codes)", () => {
    expect(resolveEntitlements(company("x"), {})).toEqual({ mode: "all" });
  });
  it("reads the company's Assortment Codes extra field", () => {
    expect(resolveEntitlements(company("electrical, lighting"), env)).toEqual({
      mode: "assortments",
      codes: ["electrical", "lighting"],
    });
  });
  it("honors the 'all' sentinel", () => {
    expect(resolveEntitlements(company("all"), env)).toEqual({ mode: "all" });
  });
  it("uses the default when no codes present", () => {
    expect(resolveEntitlements(company(), env)).toEqual({ mode: "all" });
    expect(resolveEntitlements(company(), { ...env, CATALOG_RESTRICTIONS_DEFAULT: "none" })).toEqual({
      mode: "assortments",
      codes: [],
    });
  });
});

describe("isProductVisible (closed model)", () => {
  const ent: Entitlements = { mode: "assortments", codes: ["electrical"] };
  it("shows tagged, hides untagged and non-matching", () => {
    expect(isProductVisible(["electrical"], ent)).toBe(true);
    expect(isProductVisible(["ELECTRICAL"], ent)).toBe(true); // normalized
    expect(isProductVisible([], ent)).toBe(false); // untagged hidden
    expect(isProductVisible(["plumbing"], ent)).toBe(false);
  });
  it("everything visible under mode:all", () => {
    expect(isProductVisible([], { mode: "all" })).toBe(true);
  });
});

describe("findBlockedProductIds", () => {
  it("returns non-entitled product ids using the injected resolver", async () => {
    const ent: Entitlements = { mode: "assortments", codes: ["electrical"] };
    const codesByProduct: Record<number, string[]> = { 1: ["electrical"], 2: ["plumbing"], 3: [] };
    const blocked = await findBlockedProductIds(ent, [1, 2, 3], async (id) => codesByProduct[id] ?? []);
    expect(blocked).toEqual([2, 3]);
  });
  it("blocks nothing under mode:all", async () => {
    expect(await findBlockedProductIds({ mode: "all" }, [1, 2], async () => [])).toEqual([]);
  });
});
