import type { ExtractedPo, PoLineItem, PaymentIntent } from "../types";

// Dependency-free, deterministic heuristic extractor. NOT the product — it lets the demo
// simulator and unit tests run the full pipeline with zero AI keys. When PO_AGENT_MODEL
// is configured, the pipeline uses the real LLM extractor (ai/extract.ts) instead.

function detectPaymentIntent(text: string): PaymentIntent {
  if (/\b(credit\s*card|pay\s*by\s*card|by\s*card|cc\b|visa|mastercard|amex)\b/i.test(text)) {
    return "credit_card";
  }
  if (/\b(on\s*account|pay\s*on\s*account|net\s*\d+|terms|invoice\s*me|purchase\s*order)\b/i.test(text)) {
    return "on_account";
  }
  return "unspecified";
}

function detectPoNumber(text: string): string | null {
  const m = text.match(/\bP\.?\s?O\.?\s*(?:#|no\.?|number)?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i);
  if (m) {
    const val = m[1];
    if (!/^box$/i.test(val)) return val;
  }
  return null;
}

const SKU_RE = /\b([A-Z][A-Z0-9]*-[A-Z0-9-]+)\b/i;
/** Brand-prefixed SKUs with a space and inch fractions: "VO 12111-1-1/2", "CR 147XU-2".
 * Uppercase only, so prose like "ships in 3-5 days" never reads as a SKU. */
const PREFIXED_SKU_RE = /\b([A-Z]{2} [A-Z]*\d[A-Z0-9]*(?:-[A-Z0-9]+(?:\/\d+)?)+)/;
/** A part number that starts with a digit ("12111-1-1/2") — only right after an explicit
 * SKU/item/part marker, so dates and ranges in prose aren't read as SKUs. */
const MARKED_NUMERIC_SKU_RE = /\b(?:sku|item|part\s*(?:no\.?|number|#)?)\s*[:#]?\s*(\d[A-Z0-9]*(?:-[A-Z0-9]+(?:\/\d+)?)+)/i;
const QTY_MARKED_RE = /\b(?:qty|quantity)[:\s]*([0-9]+)\b/i;
const QTY_X_RE = /\b([0-9]+)\s*(?:x|×|units?|pcs?|ea)\b/i;
const PRICE_RE = /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/;
const SKU_MARKER_RE = /\b(sku|item|part\s*(?:no|number|#)?)\b/i;

/** What's left of an item line once the SKU, quantity, price and markers are removed —
 * the buyer's own description, when there is one. */
function inlineDescription(line: string, sku: string): string | null {
  const rest = line
    .replace(sku, " ")
    .replace(new RegExp(QTY_MARKED_RE.source, "gi"), " ")
    .replace(new RegExp(QTY_X_RE.source, "gi"), " ")
    .replace(new RegExp(PRICE_RE.source, "g"), " ")
    .replace(new RegExp(SKU_MARKER_RE.source, "gi"), " ")
    .replace(/[\s:|,;#\-–—]+/g, " ")
    .trim();
  return /[a-z]{3}/i.test(rest) ? rest : null;
}

/** A plain-text line directly above an item line ("Sloan Check Valves 1\" Sweat") is that
 * item's description — unless it's a PO number, payment wording or another SKU. */
function describesNextLine(line: string): boolean {
  const t = line.trim();
  if (!/[a-z]{3}/i.test(t) || SKU_RE.test(t) || PREFIXED_SKU_RE.test(t)) return false;
  if (detectPoNumber(t) || detectPaymentIntent(t) !== "unspecified") return false;
  return !/[:?]$/.test(t);
}

function parseLine(line: string): PoLineItem | null {
  // Skip PO-number lines to avoid capturing the PO id as a SKU.
  if (/\bP\.?O\.?\s*(?:#|no\.?|number)/i.test(line) && !SKU_MARKER_RE.test(line)) return null;

  const skuMatch = line.match(PREFIXED_SKU_RE) ?? line.match(SKU_RE) ?? line.match(MARKED_NUMERIC_SKU_RE);
  if (!skuMatch) return null;

  // Quantity and price are read from the rest of the line: "CR 147XU-2 x 4" is 4, not the 2
  // at the end of the SKU.
  const rest = line.replace(skuMatch[1], " ");
  const qtyMatch = rest.match(QTY_MARKED_RE) ?? rest.match(QTY_X_RE);
  const hasMarker = SKU_MARKER_RE.test(line);
  // Only count as a line item if there is an explicit quantity or a SKU/item marker.
  if (!qtyMatch && !hasMarker) return null;

  const priceMatch = rest.match(PRICE_RE);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : null;
  const statedUnitPrice = priceMatch ? Number(priceMatch[1]) : null;

  return {
    rawText: line.trim(),
    sku: skuMatch[1].toUpperCase(),
    description: inlineDescription(line, skuMatch[1]),
    quantity: quantity && quantity > 0 ? quantity : null,
    statedUnitPrice,
    statedTotal: null,
  };
}

export interface HeuristicInput {
  subject?: string;
  bodyText?: string;
  extraText?: string;
}

export function heuristicExtract(input: HeuristicInput): ExtractedPo {
  const combined = [input.subject, input.bodyText, input.extraText].filter(Boolean).join("\n");
  const lines: PoLineItem[] = [];
  let prev: { text: string; item: boolean } | null = null;
  for (const raw of combined.split(/\r?\n/)) {
    const item = parseLine(raw);
    if (item) {
      if (!item.description && prev && !prev.item && describesNextLine(prev.text)) item.description = prev.text.trim();
      lines.push(item);
    }
    // The subject is never an item's description ("Re: Quote request" above the first line).
    const isSubject = Boolean(input.subject) && raw.trim() === input.subject!.trim();
    prev = raw.trim() && !isSubject ? { text: raw, item: Boolean(item) } : null;
  }

  const currency = /\$|\bUSD\b/i.test(combined) ? "USD" : null;
  const poNumber = detectPoNumber(combined);
  const paymentIntent = detectPaymentIntent(combined);

  if (lines.length === 0) {
    return {
      poNumber,
      buyerNote: input.bodyText?.trim() || null,
      paymentIntent,
      requestedShipDate: null,
      shipTo: null,
      billTo: null,
      lines: [
        {
          rawText: (input.bodyText || input.subject || "").trim() || "(no content)",
          sku: null,
          description: null,
          quantity: null,
          statedUnitPrice: null,
          statedTotal: null,
        },
      ],
      currency,
      confidence: "low",
    };
  }

  const allHaveQty = lines.every((l) => l.quantity != null);
  return {
    poNumber,
    buyerNote: null,
    paymentIntent,
    requestedShipDate: null,
    shipTo: null,
    billTo: null,
    lines,
    currency,
    confidence: allHaveQty ? "high" : "medium",
  };
}
