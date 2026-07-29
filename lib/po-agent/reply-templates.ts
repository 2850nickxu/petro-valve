import type { PoSession, ResolvedLine } from "./types";

// Operator reply templates for the session-detail "Reply to the buyer" card.
//
// These are DERIVED from the session's validated resolution — never invented. Every SKU,
// quantity and price interpolated below comes from `session.resolution`, so a template can
// only ever restate what the pipeline actually computed. The operator can edit the draft
// before sending; the send path itself is code-driven (see the reply route).
//
// Pure and dependency-free so the whole set is unit-testable offline.

export interface ReplyTemplate {
  id: string;
  label: string;
  text: string;
}

function money(n: number | null | undefined, currency?: string | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const code = currency && currency.trim() ? currency.trim().toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** How a line is referred to in buyer-facing copy. */
function ref(l: ResolvedLine): string {
  return l.matchedSku ?? l.line.sku ?? l.line.rawText.trim().slice(0, 60);
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function replyTemplates(session: PoSession): ReplyTemplate[] {
  const lines = session.resolution ?? [];
  const currency = session.extracted?.currency;
  const out: ReplyTemplate[] = [];

  // 1. Unmatched lines → ask for a part number, quoting the buyer's own wording.
  const unresolved = lines.filter((l) => l.issues.includes("line_unresolved"));
  if (unresolved.length) {
    const quoted = list(unresolved.map((l) => `“${l.line.rawText.trim()}”`));
    out.push({
      id: "ask_part_number",
      label: unresolved.length > 1 ? "Ask for the part numbers" : "Ask for the part number",
      text:
        `Thanks for the PO. Could you confirm the exact part number for ${quoted}? ` +
        `We couldn't match ${unresolved.length > 1 ? "these" : "it"} to your catalog. ` +
        `Once we have ${unresolved.length > 1 ? "them" : "it"}, the order goes straight through.`,
    });
  }

  // 2. Price mismatches → state both numbers and which one we'll honour.
  const mismatched = lines.filter((l) => l.issues.includes("price_mismatch"));
  if (mismatched.length) {
    const detail = mismatched
      .map(
        (l) =>
          `${ref(l)} is listed at ${money(l.line.statedUnitPrice, currency)} on the PO, ` +
          `but your contract price is ${money(l.calculatedUnitPrice, currency)}`,
      )
      .join("; ");
    out.push({
      id: "flag_price",
      label: "Flag the price difference",
      text: `Quick note before we place this: ${detail}. We'll use the contract price unless you tell us otherwise.`,
    });
  }

  // 3. Short stock → offer partial shipment with the real on-hand figure.
  const short = lines.filter((l) => l.issues.includes("line_inventory_short"));
  if (short.length) {
    const l = short[0];
    const want = l.line.quantity ?? 0;
    const have = l.inventoryLevel ?? 0;
    out.push({
      id: "partial_shipment",
      label: "Confirm partial shipment",
      text:
        `${ref(l)} has ${have} of ${want} on hand. ` +
        `Should we ship ${have} now and backorder the remaining ${Math.max(0, want - have)}, ` +
        `or hold the line until it's complete?`,
    });
  }

  // 4. Missing quantities → ask for them explicitly.
  const noQty = lines.filter((l) => l.issues.includes("missing_quantity"));
  if (noQty.length) {
    out.push({
      id: "ask_quantity",
      label: "Ask for the quantity",
      text: `Thanks for the PO. Could you confirm the quantity for ${list(noQty.map((l) => ref(l)))}? We'll place the order as soon as we have it.`,
    });
  }

  // Always available: a neutral holding note, so the card is never empty.
  out.push({
    id: "checking",
    label: "Say we're checking",
    text:
      "Thanks for your purchase order — we're reviewing it now and will come back to you shortly " +
      "with confirmation or any questions.",
  });

  return out;
}
