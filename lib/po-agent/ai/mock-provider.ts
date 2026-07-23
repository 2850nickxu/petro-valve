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
const QTY_MARKED_RE = /\b(?:qty|quantity)[:\s]*([0-9]+)\b/i;
const QTY_X_RE = /\b([0-9]+)\s*(?:x|×|units?|pcs?|ea)\b/i;
const PRICE_RE = /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/;
const SKU_MARKER_RE = /\b(sku|item|part\s*(?:no|number|#)?)\b/i;

function parseLine(line: string): PoLineItem | null {
  // Skip PO-number lines to avoid capturing the PO id as a SKU.
  if (/\bP\.?O\.?\s*(?:#|no\.?|number)/i.test(line) && !SKU_MARKER_RE.test(line)) return null;

  const skuMatch = line.match(SKU_RE);
  if (!skuMatch) return null;

  const qtyMatch = line.match(QTY_MARKED_RE) ?? line.match(QTY_X_RE);
  const hasMarker = SKU_MARKER_RE.test(line);
  // Only count as a line item if there is an explicit quantity or a SKU/item marker.
  if (!qtyMatch && !hasMarker) return null;

  const priceMatch = line.match(PRICE_RE);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : null;
  const statedUnitPrice = priceMatch ? Number(priceMatch[1]) : null;

  return {
    rawText: line.trim(),
    sku: skuMatch[1].toUpperCase(),
    description: null,
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
  for (const raw of combined.split(/\r?\n/)) {
    const item = parseLine(raw);
    if (item) lines.push(item);
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
