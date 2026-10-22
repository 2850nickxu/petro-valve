// SKU normalization for the Petro Valve catalog. Every purchasable SKU is a 2-letter brand
// prefix, a space, then MODEL-SIZE[-SUFFIX], with sizes in inches and often fractional:
// "VO 12111-1", "VO 12111-1-1/2", "VO SW12141-3/4", "CR 147XU-2". Buyers write these with
// missing/extra spaces, inch marks, mixed numbers ("1 1/2"), unicode fractions ("1½") or no
// prefix at all; this turns that into lookup candidates. Matching stays exact — fuzzy search
// is a separate, explicit step (catalog.searchProductsBySkuLike).

/** Every prefix in use on prod (survey of all 11,648 simple SKUs, 2026-10-22). */
export const BRAND_PREFIXES = ["ED", "VO", "CR", "WO", "NI", "AL", "VE", "PA", "DS", "XO", "LA", "NE"] as const;

const PREFIX_SET = new Set<string>(BRAND_PREFIXES);

const UNICODE_FRACTIONS: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
const UNICODE_FRACTION_RE = new RegExp(`(\\d)?([${Object.keys(UNICODE_FRACTIONS).join("")}])`, "g");

/** Join the words of a SKU body: digit␣digit is a size separator ("-"); anything else is glued. */
function joinBody(body: string): string {
  return body.replace(/(\S) (?=(\S))/g, (_, left: string, right: string) =>
    /\d/.test(left) && /\d/.test(right) ? `${left}-` : left,
  );
}

/** Canonical form of a buyer-written SKU, in the catalog's spelling where it can be inferred. */
export function normalizeSku(raw: string): string {
  // Vulgar fractions first: NFKC would turn "1½" into "11⁄2" and lose the whole/fraction split.
  let s = raw
    .replace(UNICODE_FRACTION_RE, (_, whole: string | undefined, frac: string) =>
      whole ? `${whole}-${UNICODE_FRACTIONS[frac]}` : UNICODE_FRACTIONS[frac],
    )
    .normalize("NFKC")
    .replace(/⁄/g, "/") // fraction slash
    .replace(/[‐-―−]/g, "-") // hyphen/dash variants
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  // Trailing inch marks after a digit: 2", 2'', 2", 2 IN, 2 INCH(ES).
  s = s.replace(/(\d)\s*(?:["“”″]|''|IN\.?|INCH(?:ES)?)$/, "$1");
  // No spaces around separators: "12111 - 1 / 2" → "12111-1/2"; then mixed numbers "1 1/2" → "1-1/2".
  s = s.replace(/\s*([-/])\s*/g, "$1").replace(/(\d) (\d+\/\d+)/g, "$1-$2");

  const m = s.match(/^([A-Z]{2}) (.+)$/);
  if (m && PREFIX_SET.has(m[1])) return `${m[1]} ${joinBody(m[2])}`;
  return joinBody(s);
}

/**
 * Exact-lookup candidates for a buyer-written SKU, most specific first. A known prefix glued
 * to the body ("VO12111-1") also yields the spaced form; a SKU with no recognised prefix also
 * yields every brand-prefixed form, so "12111-1" can find "VO 12111-1" (and the bare form can
 * still hit a configurable parent like "12111").
 */
export function skuCandidates(raw: string): string[] {
  const n = normalizeSku(raw);
  // Every catalog SKU has a digit; digit-free text is a description, not a part number.
  if (!/\d/.test(n)) return [];
  const spaced = n.match(/^([A-Z]{2}) /);
  if (spaced && PREFIX_SET.has(spaced[1])) return [n];
  const glued = n.match(/^([A-Z]{2})(\S.*)$/);
  const out = [n];
  if (glued && PREFIX_SET.has(glued[1])) out.unshift(`${glued[1]} ${glued[2]}`);
  else out.push(...BRAND_PREFIXES.map((p) => `${p} ${n}`));
  return [...new Set(out)];
}

/** Does the candidate carry the buyer's own spelling (vs. a prefix we added)? */
export function isExactCandidate(raw: string, candidate: string): boolean {
  const n = normalizeSku(raw);
  if (candidate === n) return true;
  const glued = n.match(/^([A-Z]{2})(\S.*)$/);
  return Boolean(glued && PREFIX_SET.has(glued[1]) && candidate === `${glued[1]} ${glued[2]}`);
}
