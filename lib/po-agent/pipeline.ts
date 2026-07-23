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
import type { Buyer, PoSession, PoSessionState, ResolvedLine, ExtractedPo, Decision } from "./types";
import { identify } from "./core/identify";
import { resolveChannel } from "./core/channel";
import { resolveLines, submittableLines } from "./core/resolve";
import { priceLines, estimatedSubtotal } from "./core/price";
import { validate } from "./core/validate";
import { decide, assessPayOnAccount, buyerCanPlaceOrders } from "./core/decide";
import { submitOrder } from "./core/submit-order";
import { submitQuote } from "./core/submit-quote";
import { fanOutEscalation, type MailSender } from "./escalate";
import {
  draftRejection,
  draftClarification,
  draftEscalationNotice,
  draftTriage,
  draftOrderConfirmation,
  draftQuoteConfirmation,
  draftFirstOrderConfirm,
  money,
} from "./ai/respond";

export interface PipelineDeps {
  ctx: StoreContext;
  config: PoAgentConfig;
  /** Required for real processing; optional for dry-run (side-effect-free demo). */
  store?: PoStore;
  channel: EmailChannel;
  extract: Extractor;
  /** Rep-inbox mailer for escalation (optional). */
  sendMail?: MailSender;
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
function ymd(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/** Heuristic: an extraction with no SKUs, no PO number, and low confidence isn't a PO. */
function looksLikeNonPo(e: ExtractedPo): boolean {
  return e.confidence === "low" && !e.poNumber && e.lines.every((l) => !l.sku);
}

interface ActContext {
  buyer: Buyer;
  channelId: number;
  resolved: ResolvedLine[];
  extracted: ExtractedPo;
  credit: B2BCreditConfig | null;
  quoteConfig: QuoteConfig;
  decision: Decision;
  priorState: PoSessionState;
  ts: string;
}

export async function processInbound(
  deps: PipelineDeps,
  message: InboundMessage,
  opts: ProcessOptions = {},
): Promise<PoSession> {
  const now = deps.now ?? (() => new Date().toISOString());
  const id = makeSessionId(deps.channel.id, message.threadId);

  if (!opts.dryRun && deps.store) {
    const claimed = await deps.store.claimMessage(deps.channel.id, message.messageId);
    if (!claimed) {
      const existing = await deps.store.loadSession(id);
      if (existing) return existing;
    }
  }

  const loaded = !opts.dryRun && deps.store ? await deps.store.loadSession(id).catch(() => null) : null;
  const session = loaded ?? createSession(id, deps.channel.id, message.threadId, now());
  const priorState = session.state;
  if (!session.messageIds.includes(message.messageId)) session.messageIds.push(message.messageId);

  const audit = (event: string, detail?: unknown) => session.audit.push({ at: now(), event, detail });
  const persist = async () => {
    if (opts.dryRun || !deps.store) return;
    session.updatedAt = now();
    await deps.store.saveSession(session);
  };

  if (priorState === "expired") audit("reopened");

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
      if (!opts.dryRun) {
        const r = await deps.channel.sendReply(threadOf(message), { subject: reSubject(message.subject), text: draftRejection() });
        session.result = { confirmationMessageId: r.messageId };
      }
      session.state = opts.dryRun ? "validating" : "rejected";
      await persist();
      return session;
    }

    // Non-PO mail on a fresh thread ⇒ triage once, don't churn a session.
    if (looksLikeNonPo(extracted) && priorState === "new") {
      audit("triaged");
      if (!opts.dryRun) {
        await deps.channel.sendReply(threadOf(message), { subject: reSubject(message.subject), text: draftTriage() });
      }
      session.state = opts.dryRun ? "validating" : "rejected";
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
      const actCtx: ActContext = { buyer, channelId: channel.channelId, resolved, extracted, credit, quoteConfig, decision, priorState, ts: now() };
      await actOnDecision(deps, session, message, actCtx);
    }

    await persist();
    return session;
  } catch (err) {
    audit("error", { message: err instanceof Error ? err.message : String(err) });
    if (!opts.dryRun && deps.store) {
      session.escalation = {
        reasons: ["internal_error"],
        at: now(),
        notified: await fanOutEscalation({ config: deps.config, store: deps.store, sendMail: deps.sendMail, now }, session, ["internal_error"]),
      };
    }
    session.state = "escalated";
    await persist().catch(() => {});
    return session;
  }
}

function threadOf(message: InboundMessage): ThreadRef {
  return {
    threadId: message.threadId,
    inReplyToMessageId: message.messageId,
    rfcMessageId: message.headers?.["message-id"],
    references: message.headers?.["references"],
    to: message.from,
    subject: reSubject(message.subject),
  };
}

async function actOnDecision(
  deps: PipelineDeps,
  session: PoSession,
  message: InboundMessage,
  ctx: ActContext,
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const thread = threadOf(message);
  const store = deps.store;
  const decision = ctx.decision;

  if (decision.kind === "reject") {
    const r = await deps.channel.sendReply(thread, { subject: thread.subject!, text: draftRejection() });
    session.result = { confirmationMessageId: r.messageId };
    session.state = "rejected";
    return;
  }

  if (decision.kind === "clarify") {
    session.clarificationRounds += 1;
    const r = await deps.channel.sendReply(thread, { subject: thread.subject!, text: draftClarification(session.validation ?? []) });
    session.result = { confirmationMessageId: r.messageId };
    session.state = "clarifying";
    if (store) await store.enqueue("awaiting", session.id, Date.parse(ctx.ts) || 0);
    return;
  }

  if (decision.kind === "escalate") {
    await deps.channel.sendReply(thread, { subject: thread.subject!, text: draftEscalationNotice() });
    const notified = await fanOutEscalation({ config: deps.config, store, sendMail: deps.sendMail, now }, session, decision.reasons);
    session.escalation = { reasons: decision.reasons, at: ctx.ts, notified };
    session.state = "escalated";
    return;
  }

  // order / quote — take a submission lock so a redelivery can't double-submit.
  const gotLock = store ? await store.acquireLock(session.id) : true;
  if (!gotLock) {
    session.state = "submitting";
    return;
  }
  try {
    // Daily submission cap (cost guardrail).
    if (deps.config.dailySubmitCap != null && store) {
      const count = await store.bumpDailyCap(ymd(ctx.ts), "submits");
      if (count > deps.config.dailySubmitCap) {
        session.escalation = {
          reasons: ["daily_cap"],
          at: ctx.ts,
          notified: await fanOutEscalation({ config: deps.config, store, sendMail: deps.sendMail, now }, session, ["daily_cap"]),
        };
        session.state = "escalated";
        return;
      }
    }

    if (decision.kind === "order") {
      // First-order confirmation gate (§7.8) — a spoofing backstop; order path only.
      const isConfirmReply = ctx.priorState === "awaiting_confirmation" && /\bconfirm\b/i.test(message.bodyText);
      if (deps.config.firstOrderConfirm && store && !isConfirmReply && !(await store.isTrusted(ctx.buyer.email))) {
        const r = await deps.channel.sendReply(thread, {
          subject: thread.subject!,
          text: draftFirstOrderConfirm(ctx.resolved, money(estimatedSubtotal(ctx.resolved))),
        });
        session.result = { confirmationMessageId: r.messageId };
        session.state = "awaiting_confirmation";
        await store.enqueue("awaiting", session.id, Date.parse(ctx.ts) || 0);
        return;
      }

      const res = await submitOrder(deps.ctx, {
        buyer: ctx.buyer,
        channelId: ctx.channelId,
        resolvedLines: ctx.resolved,
        extracted: ctx.extracted,
        poNumber: ctx.extracted.poNumber ?? undefined,
        credit: ctx.credit ? { limitPurchases: ctx.credit.limitPurchases, availableCredit: ctx.credit.availableCredit } : null,
      });
      if (!res.ok) {
        session.escalation = { reasons: [`submit_failed:${res.reason}`], at: ctx.ts, notified: await fanOutEscalation({ config: deps.config, store, sendMail: deps.sendMail, now }, session, [`submit_failed:${res.reason}`]) };
        session.state = "escalated";
        return;
      }
      session.result = { orderId: res.orderId };
      const r = await deps.channel.sendReply(thread, {
        subject: thread.subject!,
        text: draftOrderConfirmation({ orderId: res.orderId, poNumber: ctx.extracted.poNumber ?? undefined, resolved: ctx.resolved, totals: res.totals }),
      });
      session.result.confirmationMessageId = r.messageId;
      session.state = "completed_order";
      if (store) {
        await store.setTrusted(ctx.buyer.email);
        await store.bumpCounter(ym(ctx.ts), "orders");
      }
    } else if (decision.kind === "quote") {
      const res = await submitQuote(deps.ctx, {
        buyer: ctx.buyer,
        channelId: ctx.channelId,
        resolvedLines: ctx.resolved,
        poNumber: ctx.extracted.poNumber ?? undefined,
        expiryDays: getQuoteExpiryDays(ctx.quoteConfig),
      });
      if (!res.ok) {
        session.escalation = { reasons: [`submit_failed:${res.reason}`], at: ctx.ts, notified: await fanOutEscalation({ config: deps.config, store, sendMail: deps.sendMail, now }, session, [`submit_failed:${res.reason}`]) };
        session.state = "escalated";
        return;
      }
      session.result = { quoteId: res.quoteId, quoteNumber: res.quoteNumber, quoteUrl: res.quoteUrl, checkoutUrl: res.checkoutUrl };
      const r = await deps.channel.sendReply(thread, {
        subject: thread.subject!,
        text: draftQuoteConfirmation({ quoteNumber: res.quoteNumber ?? String(res.quoteId), resolved: ctx.resolved, checkoutUrl: res.checkoutUrl, quoteUrl: res.quoteUrl }),
      });
      session.result.confirmationMessageId = r.messageId;
      session.state = "completed_quote";
      if (store) await store.bumpCounter(ym(ctx.ts), "quotes");
    }
  } finally {
    if (store) await store.releaseLock(session.id);
  }
}
