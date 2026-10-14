import { money } from "../ai/respond";
import { submittableLines } from "../core/resolve";
import type { Address, ResolvedLine } from "../types";
import type { ReplyKind, ScenarioHit } from "./types";

// Reply bodies for the rules layer (doc §6). Deterministic templates: every SKU, price,
// quantity and stock figure is copied from the store's answers on the resolved lines, and
// the checkout link from the quote the store created. The model never writes a word here.

export interface ReplyContext {
  resolved: ResolvedLine[];
  /** Store-priced total of the quoted lines. */
  total: number;
  poNumber: string | null;
  guest: boolean;
  hits: ScenarioHit[];
  /** Availability question (I3): show on-hand stock. */
  availability: boolean;
  shipTo?: Address | null;
  quoteNumber?: string;
  checkoutUrl?: string;
  /** Decide-only run: no quote exists yet, so there's no link to show. */
  preview?: boolean;
  /** I11: the draft goes to the staff member who forwarded the request. */
  forStaff?: boolean;
}

const has = (ctx: ReplyContext, id: string) => ctx.hits.some((h) => h.id === id);

function stock(r: ResolvedLine, showCount: boolean): string {
  if (!r.inventoryTracked || r.inventoryLevel == null) return "available";
  const qty = r.line.quantity ?? 1;
  if (r.inventoryLevel >= qty) return showCount ? `in stock (${r.inventoryLevel} available)` : "in stock";
  return showCount ? `limited stock (${r.inventoryLevel} available)` : "limited stock";
}

/** One line per item: SKU, description, quantity, unit price, extended price, stock (§6.2). */
export function quoteLines(resolved: ResolvedLine[], showStock = false): string {
  return submittableLines(resolved)
    .filter((r) => r.calculatedUnitPrice != null)
    .map((r) => {
      const qty = r.line.quantity ?? 1;
      const unit = r.calculatedUnitPrice!;
      const sku = r.matchedSku ?? r.line.sku ?? "item";
      const name = r.productName ? ` — ${r.productName}` : "";
      return `• ${sku}${name} — ${qty} × ${money(unit)} = ${money(qty * unit)} — ${stock(r, showStock)}`;
    })
    .join("\n");
}

function linkLine(ctx: ReplyContext): string {
  if (ctx.checkoutUrl) return `Check out here: ${ctx.checkoutUrl}`;
  if (ctx.preview) return "Check out here: [the checkout link is created when this reply is sent]";
  return "Your checkout link is on its way in a separate email.";
}

function wrap(ctx: Pick<ReplyContext, "forStaff">, body: string): string {
  const intro = ctx.forStaff
    ? "Here's a draft reply for the customer you forwarded. Review it, then send it on.\n\n---\n\n"
    : "";
  return `${intro}Hello,\n\n${body}\n\nThank you.`;
}

export function quoteReply(ctx: ReplyContext): string {
  const parts: string[] = [];
  parts.push(ctx.availability ? "Thank you for your request. Here is current availability and pricing:" : "Thank you for your request. Here is your quote:");
  if (ctx.quoteNumber) parts.push(`Quote #: ${ctx.quoteNumber}`);
  parts.push(quoteLines(ctx.resolved, ctx.availability));
  parts.push(`Total: ${money(ctx.total)}`);
  if (ctx.poNumber) parts.push(`Your PO number ${ctx.poNumber} is on the quote and carries through to your order.`);
  parts.push(`${linkLine(ctx)}\n${ctx.guest ? "The link opens guest checkout with these items filled in." : "The link opens checkout for your account with these items filled in."}`);
  if (has(ctx, "C7")) parts.push("At checkout you can pay with a card saved on your account. We never take card payments by email.");
  if (has(ctx, "O9")) parts.push("We can't enter orders by email, but the link above takes you straight to checkout with everything filled in.");
  parts.push("Shipping and tax are calculated at checkout.");
  return wrap(ctx, parts.join("\n\n"));
}

export function resendLinkReply(ctx: ReplyContext): string {
  const quote = ctx.quoteNumber ? ` for quote ${ctx.quoteNumber}` : "";
  const link = ctx.checkoutUrl ? `Here is your checkout link${quote}:\n${ctx.checkoutUrl}` : `${linkLine(ctx)}`;
  return wrap(ctx, `Thanks for confirming. ${link}\n\nOpen it to review the items and complete checkout. Shipping and tax are calculated at checkout.`);
}

function lineRef(r: ResolvedLine, n: number): string {
  return `Line ${n} (${r.matchedSku ?? r.line.sku ?? r.line.rawText.slice(0, 40)})`;
}

function addressText(a: Address): string {
  return [a.company, a.line1, a.line2, a.city, a.state, a.zip, a.country].filter((x) => x && x.trim()).join(", ");
}

/** The questions behind a CLARIFY, one per clarify scenario. Prices are catalog prices. */
export function clarifyQuestions(ctx: ReplyContext): string[] {
  const out: string[] = [];
  const lineHits = ctx.hits.filter((h) => h.action === "CLARIFY" && h.line);
  for (const h of lineHits) {
    const r = ctx.resolved[h.line! - 1];
    if (!r) continue;
    const calc = r.calculatedUnitPrice;
    switch (h.id) {
      case "Q2":
        if (calc != null && r.line.statedUnitPrice != null) {
          out.push(
            `${lineRef(r, h.line!)}: your price is ${money(r.line.statedUnitPrice)} each; our catalog price is ${money(calc)} each. Please confirm you'd like to go ahead at ${money(calc)}.`,
          );
        }
        break;
      case "Q8":
        out.push(`${lineRef(r, h.line!)}: how many do you need?${calc != null ? ` The price at quantity 1 is ${money(calc)} each.` : ""}`);
        break;
      case "QB": {
        const limits = [r.minQty ? `at least ${r.minQty}` : "", r.maxQty ? `at most ${r.maxQty}` : ""].filter(Boolean).join(" and ");
        out.push(`${lineRef(r, h.line!)}: this item is sold in quantities of ${limits}. How many would you like?`);
        break;
      }
      case "P15": {
        const sku = (r.matchedSku ?? r.line.sku ?? "").toUpperCase();
        const lines = ctx.resolved.flatMap((x, i) => ((x.matchedSku ?? x.line.sku ?? "").toUpperCase() === sku ? [i + 1] : []));
        const sum = lines.reduce((s, i) => s + (ctx.resolved[i - 1].line.quantity ?? 0), 0);
        out.push(`${sku} appears on lines ${lines.join(" and ")}. Is that intentional, or should we combine them into one line of ${sum}?`);
        break;
      }
    }
  }
  if (has(ctx, "C11") && ctx.shipTo) out.push(`Please confirm the ship-to address: ${addressText(ctx.shipTo)}.`);
  if (has(ctx, "A10")) out.push("Your email mentions an attachment, but none came through. Could you send it again?");
  return [...new Set(out)];
}

export function clarifyReply(ctx: ReplyContext): string {
  const qs = clarifyQuestions(ctx);
  const body = qs.length
    ? `Thank you for your request. Before we send your quote, we need ${qs.length === 1 ? "one thing" : "a few things"}:\n\n${qs.map((q) => `• ${q}`).join("\n")}`
    : "Thank you for your request. Before we send your quote, could you tell us a little more about what you need?";
  return wrap(ctx, `${body}\n\nReply to this email and we'll send your quote with a checkout link.`);
}

export function draftRulesReply(kind: ReplyKind, ctx: ReplyContext): string | null {
  switch (kind) {
    case "quote":
      return quoteReply(ctx);
    case "resend_link":
      return resendLinkReply(ctx);
    case "clarify":
      return clarifyReply(ctx);
    case "none":
      return null;
  }
}
