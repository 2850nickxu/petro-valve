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
import type { Buyer, PoSession, PoSessionState, ResolvedLine, ExtractedPo, Decision, ValidationIssue, MessagePurpose, DecisionStage, SessionMessage } from "./types";
import { identify, type IdentifyResult } from "./core/identify";
import { resolveChannel } from "./core/channel";
import { resolveLines } from "./core/resolve";
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
import { fanOutEscalation, type EscalateDeps, type MailSender } from "./escalate";
import { forwardBelowContractPo } from "./escalate/forward";
import { capText, recordInbound, recordedMailer, reSubject, sendRecordedReply } from "./messages";
import {
  type DecisionStep,
  type EvaluateChecks,
  receivedStep,
  reopenedStep,
  identifiedStep,
  extractedStep,
  triagedStep,
  priceAnswerStep,
  evaluationSteps,
  decidedStep,
  outboundStep,
  forwardedStep,
  submittedStep,
  heldStep,
  errorStep,
} from "./decision-steps";
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
    messages: [],
    messageIds: [],
    createdAt: ts,
    updatedAt: ts,
  };
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
  run: number;
}

/** Append a decision step to the session's audit trail, tagged with its run. */
function pushStep(session: PoSession, at: string, run: number, step: DecisionStep): void {
  session.audit.push({ at, ...step, run });
}

/** Every email the pipeline sends gets an outbound step linked to its message-log entry. */
function outboundRecorder(session: PoSession, run: number): (entry: SessionMessage) => void {
  return (entry) => pushStep(session, entry.at, run, outboundStep(entry));
}

/** Escalation fan-out deps whose rep-inbox email is logged on the session. */
function escalateDeps(deps: PipelineDeps, session: PoSession, run: number, now: () => string): EscalateDeps {
  return {
    config: deps.config,
    store: deps.store,
    sendMail: deps.sendMail
      ? recordedMailer(
          deps.sendMail,
          session,
          { kind: "escalation_email", from: deps.mailbox, run, captured: deps.channel.id === "simulator" },
          now,
          outboundRecorder(session, run),
        )
      : undefined,
    now,
  };
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
  /** The account-level checks behind validate and decide, for the decision trail. */
  checks: EvaluateChecks;
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

  const checks: EvaluateChecks = {
    payOnAccount: { valid: payAssess.valid, reasons: payAssess.reasons, methodAvailable, creditEnabled: credit?.creditEnabled ?? false },
    availableCredit: credit?.limitPurchases ? credit.availableCredit : null,
    canOrder,
    quoteEnabled,
    hasShipTo,
    multiCurrency,
    currency: extracted.currency,
    estimatedTotal: estTotal,
  };

  return { resolved, issues, decision, credit, quoteConfig, checks };
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
  // Every message on the thread goes in the log; its position numbers this run.
  const inboundMsg = recordInbound(session, message, now(), deps.mailbox);
  const run = inboundMsg.run ?? 1;
  // Retain the original inbound once (bounded) — powers the "original email" view and
  // future full re-runs. Later messages on the thread don't overwrite it.
  if (!session.inbound) {
    session.inbound = {
      from: message.from,
      subject: message.subject,
      bodyText: capText(message.bodyText),
      receivedAt: message.receivedAt,
    };
  }

  const step = (s: DecisionStep) => pushStep(session, now(), run, s);
  const reply = async (purpose: MessagePurpose, text: string) => {
    const sent = await sendRecordedReply(deps.channel, session, threadOf(message), { subject: reSubject(message.subject), text }, { kind: "auto_reply", purpose, from: deps.mailbox, run }, now);
    pushStep(session, sent.at, run, outboundStep(sent));
    return sent;
  };
  const persist = async () => {
    if (opts.dryRun || !deps.store) return;
    session.updatedAt = now();
    await deps.store.saveSession(session);
  };

  step(receivedStep(inboundMsg));
  if (priorState === "expired") step(reopenedStep());

  // The stage in progress, so an error step says where the run broke.
  let stage: DecisionStage = "identify";
  try {
    const idres = await identify(deps.ctx, message.from);
    session.buyer = idres.buyer ?? undefined;
    step(identifiedStep(idres, message.from));
    if (!opts.dryRun && deps.store) await deps.store.bumpCounter(ym(now()), "received");

    const channel = resolveChannel({
      channelMap: deps.config.channelMap,
      fallbackChannelId: deps.ctx.channelId,
      mailbox: deps.mailbox,
      buyer: idres.buyer,
    });
    session.channelId = channel.channelId;

    stage = "extract";
    const prior = session.extracted;
    const extraction = await deps.extract(message, {
      priorExtraction: prior,
      buyerReply: prior ? message.bodyText : undefined,
    });
    const extracted = extraction.extracted;
    session.extracted = extracted;
    step(extractedStep(extracted, inboundMsg, Boolean(prior)));
    if (!opts.dryRun && deps.store && extraction.usage) {
      await deps.store.recordTokens(ym(now()), extraction.usage.model, extraction.usage.inputTokens, extraction.usage.outputTokens);
    }

    // Unknown sender ⇒ polite rejection.
    if (!idres.buyer) {
      session.validation = [{ kind: "unknown_sender", message: "unknown_sender", blocking: true }];
      session.decision = { kind: "reject", reasons: ["unknown_sender"] };
      step(decidedStep(session.decision, [], deps.config, session.clarificationRounds));
      if (!opts.dryRun) {
        const sent = await reply("rejection", draftRejection());
        session.result = { confirmationMessageId: sent.providerMessageId };
      }
      session.state = opts.dryRun ? "validating" : "rejected";
      await persist();
      return session;
    }

    // Non-PO mail on a fresh thread ⇒ triage once, don't churn a session.
    if (looksLikeNonPo(extracted) && priorState === "new") {
      step(triagedStep());
      if (!opts.dryRun) await reply("triage", draftTriage());
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
    if (priceReviewRequested) step(priceAnswerStep("review"));
    if (priceAccepted) step(priceAnswerStep("accept"));

    stage = "resolve";
    const evaluated = await evaluate(
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
    const { resolved, issues, decision, credit, quoteConfig } = evaluated;
    session.resolution = resolved;
    session.validation = issues;
    session.decision = decision;
    const readAt = now();
    for (const s of evaluationSteps(evaluated, deps.config, { clarificationRounds: session.clarificationRounds, readAt })) step(s);

    if (opts.dryRun) {
      session.state = "validating";
    } else {
      stage = "decide";
      const actCtx: ActContext = { buyer, channelId: channel.channelId, resolved, extracted, credit, quoteConfig, decision, priorState, ts: now(), run };
      await actOnDecision(deps, session, message, actCtx);
      if (deps.store && session.state === "escalated") await deps.store.bumpCounter(ym(now()), "escalations");
    }

    await persist();
    return session;
  } catch (err) {
    step(errorStep(stage, err instanceof Error ? err.message : String(err)));
    if (!opts.dryRun && deps.store) {
      session.escalation = {
        reasons: ["internal_error"],
        at: now(),
        notified: await fanOutEscalation(escalateDeps(deps, session, run, now), session, ["internal_error"]),
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
  const step = (s: DecisionStep) => pushStep(session, now(), ctx.run, s);
  const reply = async (purpose: MessagePurpose, text: string) => {
    const sent = await sendRecordedReply(deps.channel, session, thread, { subject: thread.subject!, text }, { kind: "auto_reply", purpose, from: deps.mailbox, run: ctx.run }, now);
    pushStep(session, sent.at, ctx.run, outboundStep(sent));
    return sent;
  };
  const escalate = (reasons: string[]) => fanOutEscalation(escalateDeps(deps, session, ctx.run, now), session, reasons);

  if (decision.kind === "reject") {
    const sent = await reply("rejection", draftRejection());
    session.result = { confirmationMessageId: sent.providerMessageId };
    session.state = "rejected";
    return;
  }

  if (decision.kind === "clarify") {
    session.clarificationRounds += 1;
    const sent = await reply("clarification", draftClarification(session.validation ?? []));
    session.result = { confirmationMessageId: sent.providerMessageId };
    session.state = "clarifying";
    if (store) await store.enqueue("awaiting", session.id, Date.parse(ctx.ts) || 0);
    return;
  }

  if (decision.kind === "escalate") {
    await reply("escalation_notice", draftEscalationNotice());
    const notified = await escalate(decision.reasons);
    const sendEmail = recordedMailer(
      (to, s, t) => deps.channel.sendEmail(to, s, t),
      session,
      { kind: "below_contract_forward", from: deps.mailbox, run: ctx.run, captured: deps.channel.id === "simulator" },
      now,
      outboundRecorder(session, ctx.run),
    );
    const forwarded = await forwardBelowContractPo({ ctx: deps.ctx, config: deps.config, sendEmail }, session, message);
    if (forwarded.length) step(forwardedStep(forwarded));
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
        step(heldStep("daily_cap", deps.config));
        session.escalation = {
          reasons: ["daily_cap"],
          at: ctx.ts,
          notified: await escalate(["daily_cap"]),
        };
        session.state = "escalated";
        return;
      }
    }

    if (decision.kind === "order") {
      // First-order confirmation gate (§7.8) — a spoofing backstop; order path only.
      const isConfirmReply = ctx.priorState === "awaiting_confirmation" && /\bconfirm\b/i.test(message.bodyText);
      if (deps.config.firstOrderConfirm && store && !isConfirmReply && !(await store.isTrusted(ctx.buyer.email))) {
        step(heldStep("first_order_confirm", deps.config));
        const sent = await reply("first_order_confirm", draftFirstOrderConfirm(ctx.resolved, money(estimatedSubtotal(ctx.resolved))));
        session.result = { confirmationMessageId: sent.providerMessageId };
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
        step(submittedStep({ kind: "order", ok: false, reason: res.reason }));
        session.escalation = { reasons: [`submit_failed:${res.reason}`], at: ctx.ts, notified: await escalate([`submit_failed:${res.reason}`]) };
        session.state = "escalated";
        return;
      }
      step(submittedStep({ kind: "order", ok: true, orderId: res.orderId, grandTotal: res.totals.grandTotal }));
      session.result = { orderId: res.orderId };
      const sent = await reply(
        "order_confirmation",
        draftOrderConfirmation({ orderId: res.orderId, poNumber: ctx.extracted.poNumber ?? undefined, resolved: ctx.resolved, totals: res.totals }),
      );
      session.result.confirmationMessageId = sent.providerMessageId;
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
        step(submittedStep({ kind: "quote", ok: false, reason: res.reason }));
        session.escalation = { reasons: [`submit_failed:${res.reason}`], at: ctx.ts, notified: await escalate([`submit_failed:${res.reason}`]) };
        session.state = "escalated";
        return;
      }
      step(submittedStep({ kind: "quote", ok: true, quoteId: res.quoteId, quoteNumber: res.quoteNumber, checkoutUrl: res.checkoutUrl }));
      session.result = { quoteId: res.quoteId, quoteNumber: res.quoteNumber, quoteUrl: res.quoteUrl, checkoutUrl: res.checkoutUrl };
      const sent = await reply(
        "quote_confirmation",
        draftQuoteConfirmation({ quoteNumber: res.quoteNumber ?? String(res.quoteId), resolved: ctx.resolved, checkoutUrl: res.checkoutUrl, quoteUrl: res.quoteUrl }),
      );
      session.result.confirmationMessageId = sent.providerMessageId;
      session.state = "completed_quote";
      if (store) await store.bumpCounter(ym(ctx.ts), "quotes");
    }
  } finally {
    if (store) await store.releaseLock(session.id);
  }
}
