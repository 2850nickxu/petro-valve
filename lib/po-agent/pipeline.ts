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
import type { Buyer, PoSession, PoSessionState, ResolvedLine, ExtractedPo, Decision, ValidationIssue } from "./types";
import { identify, type IdentifyResult } from "./core/identify";
import { resolveChannel } from "./core/channel";
import { resolveLines, submittableLines } from "./core/resolve";
import { priceLines, estimatedSubtotal } from "./core/price";
import { validate } from "./core/validate";
import {
  decide,
  assessPayOnAccount,
  buyerCanPlaceOrders,
  requestsPriceReview,
  acceptsContractPrice,
} from "./core/decide";
import { submitOrder } from "./core/submit-order";
import { submitQuote } from "./core/submit-quote";
import { fanOutEscalation, type MailSender } from "./escalate";
import { forwardBelowContractPo } from "./escalate/forward";
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
  /** Sandbox run (simulator submitting for real): tag created order/quote artifacts. */
  sandbox?: boolean;
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

export interface EvaluateDeps {
  ctx: StoreContext;
  config: PoAgentConfig;
}

export interface EvaluateInput {
  idres: IdentifyResult;
  channelId: number;
  channelAmbiguous: boolean;
  channelAccessDenied: boolean;
  extracted: ExtractedPo;
  clarificationRounds: number;
  /** Buyer answered a price-difference clarification by asking for a sales-priced quote. */
  priceReviewRequested?: boolean;
  /** Buyer answered a price-difference clarification by accepting the contract price. */
  priceAccepted?: boolean;
}

export interface EvaluateResult {
  resolved: ResolvedLine[];
  issues: ValidationIssue[];
  decision: Decision;
  credit: B2BCreditConfig | null;
  quoteConfig: QuoteConfig;
}

/**
 * The deterministic middle of the pipeline (§7.2–7.4): resolve → price → validate → decide,
 * from an already-identified buyer and an already-extracted PO. No email, no submit, no
 * persistence — pure evaluation over live store data. Shared by `processInbound` and the
 * staff reprocess endpoint so re-evaluation matches production exactly.
 */
export async function evaluate(deps: EvaluateDeps, input: EvaluateInput): Promise<EvaluateResult> {
  const buyer = input.idres.buyer;
  if (!buyer) throw new Error("evaluate requires an identified buyer");
  const { extracted } = input;

  const entitlements = resolveEntitlements(input.idres.company);
  const [addrs, methods, credit, quoteConfig] = await Promise.all([
    getCompanyAddresses(deps.ctx, buyer.companyId),
    getCompanyPaymentMethods(deps.ctx, buyer.companyId),
    getCompanyCreditConfig(deps.ctx, buyer.companyId),
    getQuoteConfigs(deps.ctx),
  ]);

  let resolved = await resolveLines(deps.ctx, extracted.lines, {
    entitlements,
    codeResolver: entitlements.mode === "assortments" ? metafieldCodeResolver(deps.ctx) : undefined,
  });
  resolved = await priceLines(deps.ctx, resolved, {
    customerId: buyer.customerId,
    customerGroupId: buyer.customerGroupId,
    channelId: input.channelId,
    tolerancePct: deps.config.priceTolerancePct,
    currencyCode: extracted.currency ?? undefined,
  });

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
    companyApproved: input.idres.companyApproved,
    channelAmbiguous: input.channelAmbiguous,
    channelAccessDenied: input.channelAccessDenied,
    resolvedLines: resolved,
    hasShipTo,
    multiCurrency,
    poNumberPresent: Boolean(extracted.poNumber),
    orderPathViable,
    payOnAccountReasons: payAssess.reasons,
  });

  const decision = decide({
    paymentIntent: extracted.paymentIntent,
    payOnAccountValid: payAssess.valid,
    buyerCanPlaceOrders: canOrder,
    quoteEnabled,
    issues,
    clarificationRoundsExhausted: input.clarificationRounds >= deps.config.maxClarifications,
    priceReviewRequested: input.priceReviewRequested,
    priceAccepted: input.priceAccepted,
  });

  return { resolved, issues, decision, credit, quoteConfig };
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
  // Captured before this run overwrites them: what we last asked the buyer about.
  const priorValidation = session.validation ?? [];
  if (!session.messageIds.includes(message.messageId)) session.messageIds.push(message.messageId);
  // Retain the original inbound once (bounded) — powers the "original email" view and
  // future full re-runs. Later messages on the thread don't overwrite it.
  if (!session.inbound) {
    session.inbound = {
      from: message.from,
      subject: message.subject,
      bodyText: message.bodyText.length > 32_000 ? `${message.bodyText.slice(0, 32_000)}…` : message.bodyText,
      receivedAt: message.receivedAt,
    };
  }

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
    if (!opts.dryRun && deps.store) await deps.store.bumpCounter(ym(now()), "received");

    const channel = resolveChannel({
      channelMap: deps.config.channelMap,
      fallbackChannelId: deps.ctx.channelId,
      mailbox: deps.mailbox,
      buyer: idres.buyer,
    });
    session.channelId = channel.channelId;

    const prior = session.extracted;
    const extraction = await deps.extract(message, {
      priorExtraction: prior,
      buyerReply: prior ? message.bodyText : undefined,
    });
    const extracted = extraction.extracted;
    session.extracted = extracted;
    audit("extracted", { lines: extracted.lines.length, confidence: extracted.confidence, paymentIntent: extracted.paymentIntent });
    if (!opts.dryRun && deps.store && extraction.usage) {
      await deps.store.recordTokens(ym(now()), extraction.usage.model, extraction.usage.inputTokens, extraction.usage.outputTokens);
    }

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

    // Only honour an answer to the price question on a thread where WE raised the price
    // difference — so an original PO that merely says "please quote" can't trip it.
    const answeringPrice =
      priorState === "clarifying" && priorValidation.some((v) => v.kind === "price_mismatch");
    const priceReviewRequested = answeringPrice && requestsPriceReview(message.bodyText);
    const priceAccepted = answeringPrice && acceptsContractPrice(message.bodyText);
    if (priceReviewRequested) audit("price_review_requested");
    if (priceAccepted) audit("contract_price_accepted");

    const { resolved, issues, decision, credit, quoteConfig } = await evaluate(
      { ctx: deps.ctx, config: deps.config },
      {
        idres,
        channelId: channel.channelId,
        channelAmbiguous: channel.ambiguous,
        channelAccessDenied: channel.accessDenied,
        extracted,
        clarificationRounds: session.clarificationRounds,
        priceReviewRequested,
        priceAccepted,
      },
    );
    session.resolution = resolved;
    audit("resolved", { submittable: submittableLines(resolved).length, total: resolved.length });
    session.validation = issues;
    session.decision = decision;
    audit("decided", { kind: decision.kind, reasons: decision.reasons });

    if (opts.dryRun) {
      session.state = "validating";
    } else {
      const actCtx: ActContext = { buyer, channelId: channel.channelId, resolved, extracted, credit, quoteConfig, decision, priorState, ts: now() };
      await actOnDecision(deps, session, message, actCtx);
      if (deps.store && session.state === "escalated") await deps.store.bumpCounter(ym(now()), "escalations");
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
      await deps.store.bumpCounter(ym(now()), "escalations");
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
    const forwarded = await forwardBelowContractPo(
      { ctx: deps.ctx, config: deps.config, sendEmail: (to, s, t) => deps.channel.sendEmail(to, s, t) },
      session,
      message,
    );
    if (forwarded.length) session.audit.push({ at: now(), event: "forwarded_below_contract", detail: { to: forwarded.length } });
    session.escalation = { reasons: decision.reasons, at: ctx.ts, notified, ...(forwarded.length ? { forwarded } : {}) };
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
        sandbox: deps.sandbox,
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
        await store.bumpCounter(ym(ctx.ts), "valueCents", Math.round(res.totals.grandTotal * 100));
      }
    } else if (decision.kind === "quote") {
      const res = await submitQuote(deps.ctx, {
        buyer: ctx.buyer,
        channelId: ctx.channelId,
        resolvedLines: ctx.resolved,
        poNumber: ctx.extracted.poNumber ?? undefined,
        expiryDays: getQuoteExpiryDays(ctx.quoteConfig),
        sandbox: deps.sandbox,
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
