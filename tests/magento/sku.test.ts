import { describe, it, expect } from "vitest";
import { BRAND_PREFIXES, isExactCandidate, normalizeSku, skuCandidates } from "@/lib/magento/sku";

describe("normalizeSku — buyer spellings → catalog spelling", () => {
  it.each([
    ["vo 12111-1", "VO 12111-1"],
    ["  VO   12111-1  ", "VO 12111-1"],
    ['VO 12111 - 1 1/2"', "VO 12111-1-1/2"],
    ["VO 12111-1½", "VO 12111-1-1/2"],
    ["VO 12111 ¾", "VO 12111-3/4"],
    ["VO 12111 1 1/2 in", "VO 12111-1-1/2"],
    ["VO 12111-2 INCH", "VO 12111-2"],
    ["vo sw 12141 3/4", "VO SW12141-3/4"],
    ["CR 147XU–2", "CR 147XU-2"],
    ["VO L12111FHF-2", "VO L12111FHF-2"],
    ["12111 1 1/2", "12111-1-1/2"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeSku(raw)).toBe(expected);
  });
});

describe("skuCandidates", () => {
  it("a prefixed SKU is looked up as-is", () => {
    expect(skuCandidates("vo 12111-1")).toEqual(["VO 12111-1"]);
  });
  it("a glued known prefix also tries the spaced form, first", () => {
    expect(skuCandidates("VO12111-1")).toEqual(["VO 12111-1", "VO12111-1"]);
  });
  it("no prefix: the bare form (could be a configurable parent) plus every brand", () => {
    const c = skuCandidates("12111-1");
    expect(c[0]).toBe("12111-1");
    expect(c).toContain("VO 12111-1");
    expect(c).toHaveLength(1 + BRAND_PREFIXES.length);
  });
  it("an unknown 2-letter start is part of the model, not a prefix", () => {
    const c = skuCandidates("SW12141-3/4");
    expect(c).toContain("VO SW12141-3/4");
    expect(c).not.toContain("SW 12141-3/4");
  });
  it("nothing to look up for blanks or digit-free text", () => {
    expect(skuCandidates("  ")).toEqual([]);
    expect(skuCandidates("gate valve")).toEqual([]);
  });
});

describe("isExactCandidate", () => {
  it("the buyer's own spelling (incl. glued prefix) is exact; an added prefix is not", () => {
    expect(isExactCandidate("vo 12111-1", "VO 12111-1")).toBe(true);
    expect(isExactCandidate("VO12111-1", "VO 12111-1")).toBe(true);
    expect(isExactCandidate("12111-1", "VO 12111-1")).toBe(false);
    expect(isExactCandidate("12111", "12111")).toBe(true);
  });
});
