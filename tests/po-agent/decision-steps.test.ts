import { describe, it, expect } from "vitest";
import {
  lineList,
  receivedStep,
  identifiedStep,
  extractedStep,
  resolvedStep,
  pricedStep,
  validatedStep,
  decidedStep,
  submittedStep,
  heldStep,
  outboundStep,
  forcedStep,
  noteStep,
  remindedStep,
  errorStep,
  type DecisionStep,
  type EvaluateChecks,
} from "@/lib/po-agent/decision-steps";
import type { ExtractedPo, PoLineItem, ResolvedLine, SessionMessage, ValidationIssue } from "@/lib/po-agent/types";

// The decision trail's wording is built here from structured data — these tests pin the
// sentences a reviewer reads, and that no template leaks "undefined" or "NaN".

function line(over: Partial<PoLineItem> = {}): PoLineItem {
  return { rawText: "SKU: W-1 Qty: 10", sku: "W-1", description: null, quantity: 10, statedUnitPrice: null, statedTotal: null, ...over };
}

function resolvedLine(over: Partial<ResolvedLine> = {}, lineOver: Partial<PoLineItem> = {}): ResolvedLine {
  return {
    line: line(lineOver),
    productId: 1,
    variantId: 11,
    matchedSku: lineOver.sku ?? "W-1",
    productName: "Widget",
    calculatedUnitPrice: 10,
    available: true,
    inventoryTracked: false,
    inventoryLevel: null,
    issues: [],
    ...over,
  };
}

const CHECKS: EvaluateChecks = {
  payOnAccount: { valid: true, reasons: [], methodAvailable: true, creditEnabled: true },
  availableCredit: null,
  canOrder: true,
  quoteEnabled: true,
  hasShipTo: true,
  multiCurrency: false,
  currency: null,
  estimatedTotal: 100,
};

const CONFIG = { priceTolerancePct: 2, maxClarifications: 2, dailySubmitCap: 50, firstOrderConfirm: true, reminderDays: 3 };

function msg(over: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: "m2",
    at: "2026-10-09T09:39:00.000Z",
    direction: "out",
    audience: "buyer",
    kind: "auto_reply",
    purpose: "clarification",
    status: "sent",
    to: "dana@bayoufab.com",
    subject: "Re: PO",
    text: "…",
    run: 1,
    ...over,
  };
}

function clean(step: DecisionStep) {
  expect(step.summary).toMatch(/\S/);
  expect(step.summary).not.toMatch(/undefined|NaN|null/);
}

describe("lineList", () => {
  it("writes line numbers as prose, collapsing runs of three or more", () => {
    expect(lineList([2])).toBe("line 2");
    expect(lineList([1, 3])).toBe("lines 1 and 3");
    expect(lineList([3, 1, 2, 4, 6])).toBe("lines 1–4 and 6");
    expect(lineList([1, 2])).toBe("lines 1 and 2");
    expect(lineList([1, 3, 5])).toBe("lines 1, 3 and 5");
  });
});

describe("run start", () => {
  it("names the sender and attachments on a new thread, and the reply on a later run", () => {
    const first = receivedStep(msg({ id: "m1", direction: "in", kind: "inbound", from: "dana@bayoufab.com", attachments: [{ filename: "PO-88213.pdf", mediaType: "application/pdf", size: 1 }] }));
    expect(first.summary).toBe("New email from dana@bayoufab.com on a new thread, with 1 attachment (PO-88213.pdf).");
    expect(first.sources?.map((s) => s.label)).toEqual(["Original email m1", "PO-88213.pdf"]);

    const reply = receivedStep(msg({ id: "m3", direction: "in", kind: "inbound", from: "dana@bayoufab.com", run: 2 }));
    expect(reply.summary).toBe("dana@bayoufab.com replied on the same thread.");
  });

  it("identifies a known account or names the unknown sender", () => {
    const known = identifiedStep(
      {
        buyer: { email: "dana@bayoufab.com", b2bUserId: 7, customerId: 42, companyId: 4219, role: 0, companyName: "Bayou Fabrication LLC" },
        company: null,
        companyApproved: true,
        issues: [],
      },
      "dana@bayoufab.com",
    );
    expect(known).toMatchObject({ outcome: "known_account", summary: "Sender dana@bayoufab.com matched Bayou Fabrication LLC. Company approved." });
    expect(known.sources?.map((s) => s.label)).toEqual(["Company #4219", "Customer #42"]);

    const unknown = identifiedStep({ buyer: null, company: null, companyApproved: false, issues: ["unknown_sender"] }, "x@nowhere.com");
    expect(unknown).toMatchObject({ outcome: "unknown_sender", summary: "No store account matches x@nowhere.com." });
  });

  it("summarises the extraction without naming the model", () => {
    const extracted: ExtractedPo = {
      poNumber: null, buyerNote: null, paymentIntent: "credit_card", requestedShipDate: null,
      shipTo: null, billTo: null, lines: [line()], currency: null, confidence: "low",
    };
    const step = extractedStep(extracted, msg({ id: "m1" }), false);
    expect(step).toMatchObject({ outcome: "confidence_low", summary: "No PO number, pay by card, 1 line. Each line keeps the exact text it was read from." });
  });
});

describe("resolve", () => {
  it("groups lines by how they matched and keeps the buyer's text (capped)", () => {
    const long = "x".repeat(300);
    const step = resolvedStep([
      resolvedLine(),
      resolvedLine({ productId: undefined, matchedSku: undefined, issues: ["line_unresolved"] }, { sku: "KITZ-150", rawText: long }),
      resolvedLine({ productId: undefined, matchedSku: undefined, issues: ["line_unresolved"] }, { sku: null }),
      resolvedLine({ parentSku: true, variantId: undefined, variantChoiceCount: 3, issues: ["line_parent_sku"] }),
      resolvedLine({ blockedByAssortment: true, issues: ["line_blocked_by_assortment"] }),
      resolvedLine({ issues: ["line_unresolved"], available: false }),
    ]);
    expect(step.outcome).toBe("flagged");
    expect(step.summary).toBe(
      "1 of 6 lines can be ordered. Matched by exact SKU: line 1. Parent SKU, version needed: line 4. " +
        "SKU not in the online catalog: line 2. No SKU given: line 3. Product hidden or disabled: line 6. " +
        "Not in the company's assortment: line 5.",
    );
    const lines = (step.detail as { lines: Array<{ match: string; rawText: string; versions?: number }> }).lines;
    expect(lines.map((l) => l.match)).toEqual(["exact_sku", "not_found", "no_sku", "parent_sku", "not_in_assortment", "not_purchasable"]);
    expect(lines[1].rawText).toHaveLength(121);
    expect(lines[3].versions).toBe(3);
    clean(step);
  });

  it("is ok only when every line matched by exact SKU", () => {
    expect(resolvedStep([resolvedLine()])).toMatchObject({ outcome: "ok", summary: "The line can be ordered. Matched by exact SKU: line 1." });
    expect(resolvedStep([]).summary).toBe("The PO had no lines to match.");
  });
});

describe("price", () => {
  const readAt = "2026-10-09T09:38:07.000Z";

  it("states the PO price, store price and difference for lines outside tolerance, with the setting", () => {
    const step = pricedStep(
      [
        resolvedLine({ calculatedUnitPrice: 148.2, issues: ["price_mismatch"] }, { statedUnitPrice: 132, sku: "BV3-SS-200-NPT" }),
        resolvedLine({ calculatedUnitPrice: 412 }, { statedUnitPrice: 412 }),
        resolvedLine({ calculatedUnitPrice: 38.75 }),
      ],
      CONFIG,
      readAt,
    );
    expect(step.outcome).toBe("flagged");
    expect(step.setting).toEqual({ key: "priceTolerancePct", label: "Price tolerance", value: "2%" });
    expect(step.summary).toBe(
      "Line 1: PO $132.00 vs store $148.20 (−10.9%), outside the 2% price tolerance. " +
        "Line 2 is within tolerance. Line 3: no PO price, so the store price applies.",
    );
    // The store price is kept as read, with when it was read.
    expect(step.sources?.[0]).toMatchObject({ type: "price", label: "Store price · BV3-SS-200-NPT", value: 148.2, readAt });
  });

  it("shows a PO price above the store price with a plus sign", () => {
    const step = pricedStep([resolvedLine({ calculatedUnitPrice: 10, issues: ["price_mismatch"] }, { statedUnitPrice: 10.5 })], CONFIG, readAt);
    expect(step.summary).toContain("(+5.0%)");
  });

  it("counts the rest once more than three lines are out of tolerance", () => {
    const off = () => resolvedLine({ calculatedUnitPrice: 10, issues: ["price_mismatch"] }, { statedUnitPrice: 5 });
    const step = pricedStep([off(), off(), off(), off(), off()], CONFIG, readAt);
    expect(step.summary.match(/outside the 2% price tolerance/g)).toHaveLength(3);
    expect(step.summary).toContain("2 more lines outside tolerance.");
  });

  it("covers parent SKUs, unpriced lines and a PO with nothing to price", () => {
    const step = pricedStep(
      [
        resolvedLine({ parentSku: true, calculatedUnitPrice: undefined, variantChoices: [{ variantId: 1, sku: "A-2FT", unitPrice: 18.4 }] }),
        resolvedLine({ calculatedUnitPrice: undefined }),
      ],
      CONFIG,
      readAt,
    );
    expect(step.summary).toBe("Line 1: priced per version until the buyer picks one. Line 2: the store returned no price.");
    expect(step.outcome).toBe("flagged");
    expect(pricedStep([resolvedLine({ productId: undefined })], CONFIG, readAt).summary).toBe("No matched lines to price.");
  });
});

describe("validate", () => {
  it("states stock and limits per line, the account checks, and what is blocking", () => {
    const resolved = [
      resolvedLine(),
      resolvedLine({ inventoryTracked: true, inventoryLevel: 12, issues: ["line_inventory_short"] }, { quantity: 40 }),
      resolvedLine({ minQty: 10, maxQty: 100, issues: ["line_qty_bounds"] }, { quantity: 5 }),
    ];
    const issues: ValidationIssue[] = [
      { kind: "line_inventory_short", message: "", lineRef: "W-1", blocking: true },
      { kind: "line_qty_bounds", message: "", lineRef: "W-1", blocking: true },
      { kind: "missing_ship_to", message: "", blocking: true },
      { kind: "credit_hold", message: "", blocking: false },
    ];
    const step = validatedStep(issues, resolved, {
      ...CHECKS,
      hasShipTo: false,
      payOnAccount: { valid: false, reasons: ["credit_hold"], methodAvailable: true, creditEnabled: true },
    });
    expect(step.outcome).toBe("flagged");
    expect(step.summary).toBe(
      "Line 2: 40 ordered, 12 in stock. Line 3: quantity 5 is outside the order limits (at least 10, at most 100). " +
        "Stock and order limits are fine on line 1. There's no ship-to address. " +
        "Pay on account isn't available: account on credit hold. " +
        "Blocking: not enough stock (line 2), quantity outside order limits (line 3) and no ship-to address.",
    );
    clean(step);
  });

  it("shows available credit when the company has a limit", () => {
    const step = validatedStep([], [resolvedLine()], { ...CHECKS, availableCredit: 5000, estimatedTotal: 4201.4 });
    expect(step.outcome).toBe("ok");
    expect(step.summary).toContain("Pay on account is available (estimated $4201.40, $5000.00 credit available).");
  });
});

describe("decide", () => {
  const resolved = [resolvedLine(), resolvedLine(), resolvedLine({ issues: ["line_unresolved"] })];

  it("writes one sentence per decision kind, naming the lines and the setting that applied", () => {
    expect(decidedStep({ kind: "order", reasons: ["pay_on_account"] }, resolved, CONFIG, 0)).toMatchObject({
      outcome: "order",
      summary: "Place the order on account: nothing is blocking and pay on account is available.",
    });
    expect(decidedStep({ kind: "quote", reasons: ["credit_card", "no_terms"] }, resolved, CONFIG, 0).summary).toBe(
      "Send a quote: buyer asked to pay by card and pay on account not available.",
    );
    expect(decidedStep({ kind: "quote", reasons: ["quote"] }, resolved, CONFIG, 0).summary).toBe("Send a quote.");

    const clarify = decidedStep({ kind: "clarify", reasons: ["line_unresolved"] }, resolved, CONFIG, 1);
    expect(clarify).toMatchObject({ outcome: "clarify", summary: "Ask the buyer first: no product match (line 3). Round 2 of 2." });
    expect(clarify.setting?.key).toBe("maxClarifications");

    const exhausted = decidedStep({ kind: "escalate", reasons: ["clarification_exhausted", "line_unresolved"] }, resolved, CONFIG, 2);
    expect(exhausted).toMatchObject({
      outcome: "needs_review",
      summary: "Hold for a person: out of clarification rounds and no product match (line 3). The buyer has already had 2 rounds of questions.",
    });
    expect(exhausted.setting?.value).toBe("2");

    expect(decidedStep({ kind: "escalate", reasons: ["company_not_approved"] }, resolved, CONFIG, 0).setting).toBeUndefined();
    expect(decidedStep({ kind: "reject", reasons: ["unknown_sender"] }, [], CONFIG, 0).outcome).toBe("rejected");
  });

  it("falls back to readable text for a reason it has no phrase for", () => {
    expect(decidedStep({ kind: "escalate", reasons: ["submit_failed:no_items"] }, [], CONFIG, 0).summary).toBe("Hold for a person: submit failed no items.");
  });
});

describe("acting on the decision", () => {
  it("records what was created, what failed, and what a setting held back", () => {
    expect(submittedStep({ kind: "quote", ok: true, quoteId: 9, quoteNumber: "Q-9", checkoutUrl: "https://x" }).summary).toBe("Created quote Q-9 with a checkout link.");
    expect(submittedStep({ kind: "order", ok: false, reason: "missing_address" })).toMatchObject({
      outcome: "failed",
      summary: "Couldn't create the order: missing address. Held for a person.",
    });
    expect(heldStep("daily_cap", CONFIG)).toMatchObject({
      setting: { key: "dailySubmitCap", value: "50" },
      summary: "Today's automatic submissions reached the daily cap of 50, so this is held for a person.",
    });
    expect(heldStep("first_order_confirm", CONFIG).outcome).toBe("clarify");
  });

  it("links each outbound email to its message and says how it went", () => {
    const sent = outboundStep(msg());
    expect(sent).toMatchObject({ outcome: "sent", summary: "Sent the clarifying question on the same email thread." });
    expect(sent.sources?.[0]).toMatchObject({ type: "message", id: "m2" });

    expect(outboundStep(msg({ status: "captured", purpose: "quote_confirmation" })).summary).toBe(
      "Sent the quote on the same email thread (simulator: captured, not delivered).",
    );
    expect(outboundStep(msg({ status: "failed", error: "boom" }))).toMatchObject({
      outcome: "failed",
      summary: "Couldn't send the clarifying question; the send failed.",
    });
    expect(outboundStep(msg({ audience: "internal", kind: "escalation_email", purpose: undefined, to: "reps@store.com" })).summary).toBe(
      "Sent the escalation email to reps@store.com.",
    );
    expect(outboundStep(msg({ audience: "internal", kind: "below_contract_forward", purpose: undefined, to: "rep@store.com" })).summary).toBe(
      "Forwarded the original PO to rep@store.com.",
    );
  });

  it("names the stage an error happened in, keeping the raw message out of the summary", () => {
    const step = errorStep("resolve", "ECONNRESET at /v3/pricing");
    expect(step.summary).toBe("Something went wrong during the resolve stage, so the session is held for a person.");
    expect(step.detail).toEqual({ message: "ECONNRESET at /v3/pricing", stage: "resolve" });
  });
});

describe("people and the reminder sweep", () => {
  it("names who acted", () => {
    // No per-user logins: a person acting in the app is the "Sales agent" (legacy "staff" too).
    expect(noteStep("staff").summary).toBe("Sales agent added an internal note.");
    expect(noteStep(undefined).summary).toBe("Sales agent added an internal note.");
    expect(noteStep("Sales agent").summary).toBe("Sales agent added an internal note.");
    expect(forcedStep("Grant", "force_order", { orderId: 77 })).toMatchObject({
      event: "forced_force_order",
      stage: "human",
      summary: "Grant forced an order. Order #77 placed.",
    });
    expect(remindedStep(CONFIG)).toMatchObject({ stage: "lifecycle", summary: "Sent the buyer one reminder after 3 days without a reply." });
  });
});
