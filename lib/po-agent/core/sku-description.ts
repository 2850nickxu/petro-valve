import type { ResolvedLine } from "../types";

// SKU / description agreement (validate stage). When the buyer gives both a SKU and a
// description, the SKU decides which product we match — so a typo'd or copy-pasted SKU
// can silently turn "check valve" into "nitrile gloves". This compares the buyer's words
// with the matched product's name and flags the line when they clearly disagree. Pure,
// deterministic code — no model.
//
// It deliberately flags only clear disagreement, so ordinary PO shorthand passes:
//   - no words in common at all, after allowing abbreviations ("VLV" ~ "valve",
//     "NDL" ~ "needle") and plurals — only when the description has at least two real
//     words (3+ letters), so spec shorthand like "1/2 NPT SS" isn't read as a product; or
//   - both name a different member of the same exclusive family (a ball valve is not a
//     gate valve; brass is not stainless).
// Numbers and sizes are ignored — size mismatches are a different check.

/** Words that say nothing about what the product is. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "each", "per", "pcs", "pc", "qty", "item", "items", "sku", "part", "parts",
  "number", "no", "new", "pack", "box", "case", "set", "kit", "inch", "inches", "feet", "foot",
  "please", "order", "send", "ship", "need", "want", "via", "from", "size", "type", "style", "series",
  "in", "ft", "ea", "of", "to", "on", "by", "or", "an", "as", "at", "is", "it", "pk",
]);

/** Members of a family are mutually exclusive: naming two different ones is a conflict. A
 * starting list, to tune once the client's business rules are settled. */
const EXCLUSIVE_FAMILIES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["ball", "gate", "check", "globe", "butterfly", "needle", "plug", "relief", "solenoid", "diaphragm", "knife"]),
  new Set(["brass", "bronze", "copper", "pvc", "cpvc", "stainless", "galvanized", "aluminum", "nitrile", "latex", "vinyl"]),
];

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Significant words: lower-cased, plural-stripped, at least one letter, 2+ characters, not
 * a stopword. Pure numbers and sizes ("3/8", "150", "1in") are dropped. */
export function significantWords(text: string, exclude: string[] = []): string[] {
  const skip = new Set(exclude.flatMap((e) => e.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && /[a-z]/.test(w) && !/^\d+[a-z]{0,2}$/.test(w) && !skip.has(w))
    .map(stem)
    .filter((w) => !STOPWORDS.has(w));
  return [...new Set(words)];
}

/** "vlv" ~ "valve": same first letter, and every letter of the short form appears in order. */
function isAbbreviation(short: string, long: string): boolean {
  if (short.length < 3 || short.length >= long.length || short[0] !== long[0]) return false;
  let j = 0;
  for (const ch of long) if (ch === short[j]) j++;
  return j === short.length;
}

function wordsMatch(a: string, b: string): boolean {
  return a === b || isAbbreviation(a, b) || isAbbreviation(b, a);
}

export interface DescriptionConflict {
  /** Plain-language reason, built from the words compared. */
  reason: string;
}

/**
 * Do the buyer's description and the matched product's name clearly disagree? Returns
 * undefined when they agree or when there isn't enough to compare.
 */
export function descriptionConflict(description: string, productName: string, sku?: string | null): DescriptionConflict | undefined {
  // Buyers often repeat the SKU in the description; its fragments say nothing about the
  // product. The product name keeps every word (a SKU like WIDGET-100 shares "widget").
  const said = significantWords(description, sku ? [sku] : []);
  const named = significantWords(productName);
  if (!said.length || !named.length) return undefined;

  for (const family of EXCLUSIVE_FAMILIES) {
    const a = said.filter((w) => family.has(w));
    const b = named.filter((w) => family.has(w));
    if (a.length && b.length && !a.some((w) => b.includes(w))) {
      return { reason: `the buyer wrote "${a.join(", ")}" but the product is "${b.join(", ")}"` };
    }
  }

  const words = said.filter((w) => w.length >= 3);
  const shared = said.some((s) => named.some((n) => wordsMatch(s, n)));
  if (words.length >= 2 && !shared) return { reason: "the description and the product name have no words in common" };
  return undefined;
}

/**
 * Flag lines whose SKU matched a product that the buyer's own description contradicts.
 * Only lines with a buyer SKU, a buyer description and a matched, named product are
 * checked. Returns new line objects; the input is not mutated.
 */
export function checkSkuDescription(lines: ResolvedLine[]): ResolvedLine[] {
  return lines.map((l) => {
    const description = l.line.description?.trim();
    if (!l.line.sku || !l.matchedSku || !l.productName || !description) return l;
    if (l.issues.includes("line_sku_description_conflict")) return l;
    const conflict = descriptionConflict(description, l.productName, l.line.sku);
    if (!conflict) return l;
    return { ...l, issues: [...l.issues, "line_sku_description_conflict"], descriptionConflict: conflict.reason };
  });
}
