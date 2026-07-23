import type { StoreContext } from "@/lib/bc/store-context";
import { getCompanyAddresses, getCompanyCreditConfig, defaultShipping } from "@/lib/bc/companies";
import { getCompanyPaymentMethods, hasEnabledPaymentCode } from "@/lib/bc/payments";
import { getQuoteConfigs, getQuoteExpiryDays, type QuoteConfig } from "@/lib/bc/quote-config";
import { isQuoteAllowed } from "@/lib/bc/quote-gate";
import { resolveEntitlements, metafieldCodeResolver } from "@/lib/bc/restrictions";
import type { B2BCreditConfig } from "@/lib/bc/types";

import type { PoAgentConfig } from "./config";
import type { PoStore } from "./store";
import { sessionId as makeSessionId } from "./store";
import type { EmailChannel, InboundMessage, Extractor, ThreadRef } from "./channel/types";
import type { Buyer, PoSession, ResolvedLine, ExtractedPo, Decision } from "./types";
import { identify } from "./core/identify";
import { resolveChannel } from "./core/channel";
import { resolveLines, submittableLines } from "./core/resolve";
import { priceLines, estimatedSubtotal } from "./core/price";
import { validate } from "./core/validate";
import { decide, assessPayOnAccount, buyerCanPlaceOrders } from "./core/decide";
import { submitOrder } from "./core/submit-order";
import { submitQuote } from "./core/submit-quote";

export interface PipelineDeps {
  ctx: StoreContext;
  config: PoAgentConfig;
  /** Required for real processing; optional for dry-run (side-effect-free demo). */
  store?: PoStore;
  channel: EmailChannel;
  extract: Extractor;
  /** Monitored mailbox (for the MSF channel map). */
  mailbox?: string;
  /** Injectable clock (ISO string) for deterministic tests. */
  now?: () => string;
}

export interface ProcessOptions {
  /** Decide but do NOT submit or send email (the demo simulator / vertical slice). */
  dryRun?: boolean;
}

function createSession(id: string, channel: EmailChannel["id"], threadId: string, ts: string): PoSession {
  return {
    id,
    channel,
    threadId,
    state: "new",
    clarificationRounds: 0,
    audit: [],
    messageIds: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

function reSubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject || "your purchase order"}`;
}
function ym(iso: string): string {
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}`;
}
function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function lineSummary(resolved: ResolvedLine[]): string {
  return submittableLines(resolved)
    .map((l) => {
      const qty = l.line.quantity ?? 1;
      const unit = l.calculatedUnitPrice ?? l.line.statedUnitPrice ?? 0;
      const sku = l.matchedSku ?? l.line.sku ?? "item";
      return `• ${qty} × ${sku} @ ${money(unit)} = ${money(qty * unit)}`;
    })
    .join("\n");
}

interface ActContext {
  buyer: Buyer;
  channelId: number;
  resolved: ResolvedLine[];
  extracted: ExtractedPo;
  credit: B2BCreditConfig | null;
  quoteConfig: QuoteConfig;
  decision: Decision;
  ts: string;
}

export async function processInbound(
  deps: PipelineDeps,
  message: InboundMessage,
  opts: ProcessOptions = {},
): Promise<PoSession> {
  const now = deps.now ?? (() => new Date().toISOString());
  const id = makeSessionId(deps.channel.id, message.threadId);

  // Message-level dedupe (skip in dry-run so the demo can re-run the same PO).
  if (!opts.dryRun && deps.store) {
    const claimed = await deps.store.claimMessage(deps.channel.id, message.messageId);
    if (!claimed) {
      const existing = await deps.store.loadSession(id);
      if (existing) return existing;
    }
  }

  const loaded = !opts.dryRun && deps.store ? await deps.store.loadSession(id).catch(() => null) : null;
  const session = loaded ?? createSession(id, deps.channel.id, message.threadId, now());
  if (!session.messageIds.includes(message.messageId)) session.messageIds.push(message.messageId);

  const audit = (event: string, detail?: unknown) => session.audit.push({ at: now(), event, detail });
  const persist = async () => {
    if (opts.dryRun || !deps.store) return;
    session.updatedAt = now();
    await deps.store.saveSession(session);
    if (session.state === "escalated") {
      await deps.store.enqueue("escalated", session.id, Date.parse(session.updatedAt) || 0);
    }
  };

  try {
    const idres = await identify(deps.ctx, message.from);
    session.buyer = idres.buyer ?? undefined;
    audit("identified", { found: Boolean(idres.buyer), companyApproved: idres.companyApproved });

    const channel = resolveChannel({
      channelMap: deps.config.channelMap,
      fallbackChannelId: deps.ctx.channelId,
      mailbox: deps.mailbox,
      buyer: idres.buyer,
    });
    session.channelId = channel.channelId;

    const prior = session.extracted;
    const { extracted } = await deps.extract(message, {
      priorExtraction: prior,
      buyerReply: prior ? message.bodyText : undefined,
    });
    session.extracted = extracted;
    audit("extracted", { lines: extracted.lines.length, confidence: extracted.confidence, paymentIntent: extracted.paymentIntent });

    // Unknown sender ⇒ polite rejection.
    if (!idres.buyer) {
      session.validation = [{ kind: "unknown_sender", message: "unknown_sender", blocking: true }];
      session.decision = { kind: "reject", reasons: ["unknown_sender"] };
      if (opts.dryRun) {
        session.state = "validating";
      } else {
        await actOnDecision(deps, session, message, null);
      }
      await persist();
      return session;
    }

    const buyer = idres.buyer;
    const companyId = buyer.companyId;

    const entitlements = resolveEntitlements(idres.company);
    const [addrs, methods, credit, quoteConfig] = await Promise.all([
      getCompanyAddresses(deps.ctx, companyId),
      getCompanyPaymentMethods(deps.ctx, companyId),
      getCompanyCreditConfig(deps.ctx, companyId),
      getQuoteConfigs(deps.ctx),
    ]);

    let resolved = await resolveLines(deps.ctx, extracted.lines, {
      entitlements,
      codeResolver: entitlements.mode === "assortments" ? metafieldCodeResolver(deps.ctx) : undefined,
    });
    resolved = await priceLines(deps.ctx, resolved, {
      customerId: buyer.customerId,
      customerGroupId: buyer.customerGroupId,
      channelId: channel.channelId,
      tolerancePct: deps.config.priceTolerancePct,
      currencyCode: extracted.currency ?? undefined,
    });
    session.resolution = resolved;
    audit("resolved", { submittable: submittableLines(resolved).length, total: resolved.length });

    const estTotal = estimatedSubtotal(resolved);
    const methodAvailable = hasEnabledPaymentCode(methods, deps.config.poPaymentCodes);
    const payAssess = assessPayOnAccount({
      methodAvailable,
      creditEnabled: credit?.creditEnabled ?? false,
      creditHold: credit?.creditHold ?? false,
      limitPurchases: credit?.limitPurchases ?? false,
      estimatedTotal: estTotal,
      availableCredit: credit?.availableCredit ?? 0,
    });
    const canOrder = buyerCanPlaceOrders(buyer.role);
    const quoteEnabled = isQuoteAllowed(quoteConfig, "company");
    const hasShipTo = Boolean(extracted.shipTo?.line1) || Boolean(defaultShipping(addrs));
    const multiCurrency = Boolean(extracted.currency) && extracted.currency!.toUpperCase() !== "USD";
    const orderPathViable = payAssess.valid && canOrder && extracted.paymentIntent !== "credit_card";

    const issues = validate({
      buyer,
      companyApproved: idres.companyApproved,
      channelAmbiguous: channel.ambiguous,
      channelAccessDenied: channel.accessDenied,
      resolvedLines: resolved,
      hasShipTo,
      multiCurrency,
      poNumberPresent: Boolean(extracted.poNumber),
      orderPathViable,
      payOnAccountReasons: payAssess.reasons,
    });
    session.validation = issues;

    const decision = decide({
      paymentIntent: extracted.paymentIntent,
      payOnAccountValid: payAssess.valid,
      buyerCanPlaceOrders: canOrder,
      quoteEnabled,
      issues,
      clarificationRoundsExhausted: session.clarificationRounds >= deps.config.maxClarifications,
    });
    session.decision = decision;
    audit("decided", { kind: decision.kind, reasons: decision.reasons });

    if (opts.dryRun) {
      session.state = "validating";
    } else {
      const ctx: ActContext = { buyer, channelId: channel.channelId, resolved, extracted, credit, quoteConfig, decision, ts: now() };
      await actOnDecision(deps, session, message, ctx);
    }

    await persist();
    return session;
  } catch (err) {
    audit("error", { message: err instanceof Error ? err.message : String(err) });
    session.state = "escalated";
    session.escalation = { reasons: ["internal_error"], at: now(), notified: ["queue"] };
    await persist().catch(() => {});
    return session;
  }
}

async function actOnDecision(
  deps: PipelineDeps,
  session: PoSession,
  message: InboundMessage,
  ctx: ActContext | null,
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const thread: ThreadRef = {
    threadId: message.threadId,
    inReplyToMessageId: message.messageId,
    subject: reSubject(message.subject),
  };
  const decision = ctx?.decision ?? session.decision;

  if (!decision || decision.kind === "reject") {
    const r = await deps.channel.sendReply(thread, {
      subject: thread.subject!,
      text: "Hello,\n\nWe received your message but couldn't match your email address to a company account, so we're unable to process this purchase order automatically. Please contact your sales representative.\n\nThank you.",
    });
    session.result = { confirmationMessageId: r.messageId };
    session.state = "rejected";
    return;
  }

  if (decision.kind === "clarify") {
    session.clarificationRounds += 1;
    const blocking = (session.validation ?? []).filter((i) => i.blocking);
    const bullets = blocking.map((i) => `• ${i.message}${i.lineRef ? ` (${i.lineRef})` : ""}`).join("\n");
    const r = await deps.channel.sendReply(thread, {
      subject: thread.subject!,
      text: `Hello,\n\nBefore we can process your purchase order, we need a bit more information:\n\n${bullets}\n\nPlease reply with these details and we'll proceed right away.\n\nThank you.`,
    });
    session.result = { confirmationMessageId: r.messageId };
    session.state = "clarifying";
    if (deps.store) await deps.store.enqueue("awaiting", session.id, Date.parse(now()) || 0);
    return;
  }

  if (decision.kind === "escalate") {
    await deps.channel.sendReply(thread, {
      subject: thread.subject!,
      text: "Hello,\n\nThank you for your purchase order. A member of our team will review it and follow up with you shortly.\n\nThank you.",
    });
    session.escalation = { reasons: decision.reasons, at: now(), notified: ["queue"] };
    session.state = "escalated";
    return;
  }

  if (!ctx) return;

  // order / quote — take a submission lock so a redelivery can't double-submit.
  const store = deps.store;
  const gotLock = store ? await store.acquireLock(session.id) : true;
  if (!gotLock) {
    session.state = "submitting";
    return;
  }
  try {
    if (decision.kind === "order") {
      const res = await submitOrder(deps.ctx, {
        buyer: ctx.buyer,
        channelId: ctx.channelId,
        resolvedLines: ctx.resolved,
        extracted: ctx.extracted,
        poNumber: ctx.extracted.poNumber ?? undefined,
        credit: ctx.credit ? { limitPurchases: ctx.credit.limitPurchases, availableCredit: ctx.credit.availableCredit } : null,
      });
      if (!res.ok) {
        session.state = "escalated";
        session.escalation = { reasons: [`submit_failed:${res.reason}`], at: ctx.ts, notified: ["queue"] };
        return;
      }
      session.result = { orderId: res.orderId };
      const text = `Hello,\n\nYour order has been placed on account.\n\nOrder #: ${res.orderId}\nPO #: ${ctx.extracted.poNumber ?? "(none provided)"}\n\n${lineSummary(ctx.resolved)}\n\nSubtotal: ${money(res.totals.subtotal)}\nShipping: ${money(res.totals.shippingTotal)}\nTax: ${money(res.totals.taxTotal)}\nTotal: ${money(res.totals.grandTotal)}\n\nThank you.`;
      const r = await deps.channel.sendReply(thread, { subject: thread.subject!, text });
      session.result.confirmationMessageId = r.messageId;
      session.state = "completed_order";
      if (store) await store.bumpCounter(ym(ctx.ts), "orders");
    } else if (decision.kind === "quote") {
      const res = await submitQuote(deps.ctx, {
        buyer: ctx.buyer,
        channelId: ctx.channelId,
        resolvedLines: ctx.resolved,
        poNumber: ctx.extracted.poNumber ?? undefined,
        expiryDays: getQuoteExpiryDays(ctx.quoteConfig),
      });
      if (!res.ok) {
        session.state = "escalated";
        session.escalation = { reasons: [`submit_failed:${res.reason}`], at: ctx.ts, notified: ["queue"] };
        return;
      }
      session.result = { quoteId: res.quoteId, quoteNumber: res.quoteNumber, quoteUrl: res.quoteUrl, checkoutUrl: res.checkoutUrl };
      const payLine = res.checkoutUrl ? `\nPay by card here: ${res.checkoutUrl}` : "";
      const portalLine = res.quoteUrl ? `\nView in the Buyer Portal: ${res.quoteUrl}` : "";
      const text = `Hello,\n\nWe've prepared a quote for your purchase order.\n\nQuote #: ${res.quoteNumber ?? res.quoteId}\n\n${lineSummary(ctx.resolved)}${payLine}${portalLine}\n\nThank you.`;
      const r = await deps.channel.sendReply(thread, { subject: thread.subject!, text });
      session.result.confirmationMessageId = r.messageId;
      session.state = "completed_quote";
      if (store) await store.bumpCounter(ym(ctx.ts), "quotes");
    }
  } finally {
    if (store) await store.releaseLock(session.id);
  }
}
