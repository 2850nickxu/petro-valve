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

/** How many child variants a draft lists before summarising the rest. */
const MAX_CHOICES = 8;

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

  // 2. Parent SKUs → name the versions (and their prices) and ask which one.
  const parents = lines.filter((l) => l.issues.includes("line_parent_sku"));
  if (parents.length) {
    const blocks = parents.map((l) => {
      const choices = l.variantChoices ?? [];
      const shown = choices.slice(0, MAX_CHOICES);
      const menu = shown
        .map((c) => {
          const label = c.optionLabel ? ` — ${c.optionLabel}` : "";
          const price = c.unitPrice != null ? ` — ${money(c.unitPrice, currency)} ea` : "";
          return `  · ${c.sku}${label}${price}`;
        })
        .join("\n");
      const total = l.variantChoiceCount ?? choices.length;
      const more = total > shown.length ? `\n  · …and ${total - shown.length} more.` : "";
      const head =
        `${ref(l)}${l.productName ? ` (${l.productName})` : ""} is a parent part number — ` +
        `it comes in ${total} version${total === 1 ? "" : "s"}, so we need to know which one you want`;
      return menu ? `${head}:\n${menu}${more}` : `${head}.`;
    });
    out.push({
      id: "ask_variant",
      label: parents.length > 1 ? "Ask which versions" : "Ask which version",
      text:
        `Thanks for the PO — one thing before we place it.\n\n${blocks.join("\n\n")}\n\n` +
        `Reply with the part number${parents.length > 1 ? "s" : ""} you need and we'll get this moving.`,
    });
  }

  // 2b. SKU/description conflicts → quote both sides and ask which one they meant.
  const conflicting = lines.filter((l) => l.issues.includes("line_sku_description_conflict"));
  if (conflicting.length) {
    const detail = conflicting
      .map((l) => `  · ${ref(l)} is our ${l.productName ?? "catalog item"}, but your PO describes it as “${l.line.description ?? l.line.rawText.trim()}”`)
      .join("\n");
    out.push({
      id: "ask_which_product",
      label: conflicting.length > 1 ? "Ask which products they meant" : "Ask which product they meant",
      text:
        `Thanks for the PO — before we place it, the part number and description don't match:\n\n${detail}\n\n` +
        `Could you confirm which product you need? A corrected part number is perfect.`,
    });
  }

  // 3. Price mismatches → state both numbers, then offer the two real choices.
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
      text:
        `Quick note before we place this: ${detail}. ` +
        `Reply CONFIRM and we'll place the order at the contract price, or reply QUOTE and ` +
        `we'll send this to your sales team to review for specialty pricing first.`,
    });
    out.push({
      id: "offer_price_review",
      label: "Offer a sales-priced quote",
      text:
        `Thanks for the PO. ${detail}. ` +
        `If you were expecting the price on your PO, we can send this to your sales team as a ` +
        `quote so they can review it for specialty pricing — just reply QUOTE and we'll hold the ` +
        `order until they've come back to you.`,
    });
  }

  // 4. Short stock → offer partial shipment with the real on-hand figure.
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

  // 5. Missing quantities → ask for them explicitly.
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
