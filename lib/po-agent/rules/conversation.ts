import type { StoreContext } from "@/lib/bc/store-context";
import type { PoAgentConfig } from "../config";
import type { PoStore } from "../store";
import { sessionId as makeSessionId } from "../store";
import type { EmailChannel, Extractor, InboundMessage, ThreadRef } from "../channel/types";
import { identify, type IdentifyResult } from "../core/identify";
import { resolveChannel } from "../core/channel";
import { estimatedSubtotal } from "../core/price";
import { submittableLines } from "../core/resolve";
import { submitQuote } from "../core/submit-quote";
import { evaluate, evaluateCatalog } from "../pipeline";
import { capText, recordDraft, recordInbound, reSubject, sendRecordedReply } from "../messages";
import {
  classifiedStep,
  draftedStep,
  errorStep,
  extractedStep,
  handoffStep,
  heldDraftStep,
  identifiedStep,
  outboundStep,
  pricedStep,
  receivedStep,
  resolvedStep,
  rulesDecidedStep,
  submittedStep,
  type DecisionStep,
} from "../decision-steps";
import type { DecisionKind, ExtractedPo, MessagePurpose, PoSession, ResolvedLine, SessionMessage, ValidationIssue } from "../types";
import { detectPaymentData, heuristicClassify, newestMessage, redactPaymentData, type Classifier } from "./classify";
import type { RulesConfig } from "./config";
import { decideByRules, isFreeDomain, isStaffSender, type RulesInput } from "./engine";
import { buildDecisionRecord } from "./record";
import { clarifyQuestions, draftRulesReply, type ReplyContext } from "./reply";
import type { Classification, DecisionRecord, ReplyKind, RulesAction, RulesOutcome, RulesThreadState } from "./types";

// One turn of a simulated email conversation, decided by the Petro Valve rules: the
// customer's message comes in, the agent classifies it, reads and prices the request
// against the store, applies the rules, and answers — a quote with a checkout link, a
// question, a held draft, or nothing. An escalation sends nothing: it's handed to a sales
// agent, who replies to the customer from the session.
//
// "decide" mode stops at the answer: nothing is stored, no quote is created and the reply
// is only a preview. "reply" mode is the full conversation: the session is saved (marked
// simulated), a real quote is created in the connected test store (tagged as a sandbox
// artifact), and every reply goes through the simulator channel — captured, never emailed.
// Code drives every action; the model only classifies and extracts.

export interface ConversationDeps {
  ctx: StoreContext;
  config: PoAgentConfig;
  rules: RulesConfig;
  /** Required in reply mode. In decide mode it's only used to record token usage — the
   * run itself is never saved. */
  store?: PoStore;
  /** Always the simulator channel: sends are captured, never delivered. */
  channel: EmailChannel;
  extract: Extractor;
  classify: Classifier;
  mailbox?: string;
  now?: () => string;
}

export interface TurnResult {
  session: PoSession;
  outcome: RulesOutcome;
  record: DecisionRecord;
}

const MAX_RECORDS = 50;

/** Clarify scenarios a customer's answer resolves (see RulesInput.thread.answered). */
const ANSWERABLE = ["Q2", "C11", "P15"];

const PURPOSE: Record<Exclude<ReplyKind, "none">, MessagePurpose> = {
  quote: "quote_confirmation",
  resend_link: "checkout_link_resend",
  clarify: "clarification",
};

function ym(iso: string): string {
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}`;
}

function newSession(threadId: string, ts: string, reviewAll: boolean): PoSession {
  return {
    id: makeSessionId("simulator", threadId),
    channel: "simulator",
    threadId,
    state: "new",
    clarificationRounds: 0,
    audit: [],
    messages: [],
    messageIds: [],
    createdAt: ts,
    updatedAt: ts,
    simulated: true,
    rules: { records: [], clarificationRoundsUsed: 0, humanOwned: false, reviewAll },
  };
}

function threadFor(message: InboundMessage, subject: string): ThreadRef {
  return {
    threadId: message.threadId,
    inReplyToMessageId: message.messageId,
    to: message.from,
    subject,
  };
}

/** The session-level decision kind the rest of the app reads (badges, summaries). */
function decisionKind(o: RulesOutcome): DecisionKind {
  switch (o.action) {
    case "AUTO_RESPOND":
      return "quote";
    case "CLARIFY":
      return "clarify";
    case "HOLD":
      return o.replyKind === "clarify" ? "clarify" : "quote";
    case "ESCALATE":
      return "escalate";
    case "NO_RESPONSE":
      return "reject";
  }
}

function lastAgentReply(session: PoSession): string | undefined {
  const out = (session.messages ?? []).filter((m) => m.direction === "out" && m.audience === "buyer" && m.status !== "held");
  return out[out.length - 1]?.text;
}

/** The ship-to on the PO differs from the account's default (C11). Guests give their
 * address at checkout, so a guest ship-to isn't a question. */
function newShipTo(extracted: ExtractedPo | undefined, known: boolean, def?: { line1?: string; zip?: string }): boolean {
  const s = extracted?.shipTo;
  if (!known || !s?.line1?.trim()) return false;
  if (!def?.line1) return true;
  const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(s.line1) !== norm(def.line1) || (Boolean(s.zip) && Boolean(def.zip) && norm(s.zip) !== norm(def.zip));
}

export async function runSimulatedTurn(
  deps: ConversationDeps,
  message: InboundMessage,
  opts: { mode: "decide" | "reply" },
): Promise<TurnResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const reply = opts.mode === "reply";
  if (reply && !deps.store) throw new Error("Reply mode needs Redis to keep the conversation.");

  const id = makeSessionId("simulator", message.threadId);
  const loaded = reply ? await deps.store!.loadSession(id) : null;
  const session = loaded ?? newSession(message.threadId, now(), deps.rules.reviewAll);
  session.simulated = true;
  const rules: RulesThreadState = (session.rules ??= { records: [], clarificationRoundsUsed: 0, humanOwned: false, reviewAll: deps.rules.reviewAll });
  rules.reviewAll = deps.rules.reviewAll;
  const priorState = session.state;
  const priorAction = rules.lastAction;
  const priorRecord = rules.records[rules.records.length - 1];

  // Card and bank numbers never reach storage, the model or a reply (C8).
  const paymentData = detectPaymentData(`${message.subject}\n${message.bodyText}`);
  const safe: InboundMessage = paymentData
    ? { ...message, subject: redactPaymentData(message.subject), bodyText: redactPaymentData(message.bodyText) }
    : message;

  if (!session.messageIds.includes(safe.messageId)) session.messageIds.push(safe.messageId);
  const inbound = recordInbound(session, safe, now(), deps.mailbox);
  const run = inbound.run ?? 1;
  if (!session.inbound) {
    session.inbound = { from: safe.from, subject: safe.subject, bodyText: capText(safe.bodyText), receivedAt: safe.receivedAt };
  }
  const step = (s: DecisionStep) => session.audit.push({ at: now(), ...s, run });
  const tokens = async (u?: { model: string; inputTokens: number; outputTokens: number }) => {
    // Model spend is real in both modes, so it always counts toward Token usage.
    if (deps.store && u) await deps.store.recordTokens(ym(now()), u.model, u.inputTokens, u.outputTokens).catch(() => {});
  };
  step(receivedStep(inbound));

  let systemError: RulesInput["systemError"];

  // Classify the newest message.
  const newest = newestMessage(safe.subject, safe.bodyText);
  const classifyInput = {
    from: safe.from,
    subject: safe.subject,
    body: newest,
    hasAttachments: safe.attachments.length > 0,
    ...(priorAction ? { thread: { priorAction, lastReply: lastAgentReply(session) } } : {}),
  };
  let classification: Classification;
  try {
    const r = await deps.classify(classifyInput);
    classification = r.classification;
    await tokens(r.usage);
  } catch (err) {
    systemError = "model";
    classification = heuristicClassify(classifyInput);
    step(errorStep("classify", err instanceof Error ? err.message : String(err)));
  }
  classification.paymentData ||= paymentData;
  step(classifiedStep(classification, inbound));

  // Identify, read and price the request.
  let idres: IdentifyResult | null = null;
  let extracted: ExtractedPo | undefined = session.extracted;
  let resolved: ResolvedLine[] = [];
  let issues: ValidationIssue[] = [];
  let defaultShipTo: { line1?: string; zip?: string } | undefined;
  let channelId = deps.ctx.channelId;
  if (!systemError) {
    try {
      idres = await identify(deps.ctx, safe.from);
      session.buyer = idres.buyer ?? undefined;
      step(identifiedStep(idres, safe.from));
      channelId = resolveChannel({ channelMap: deps.config.channelMap, fallbackChannelId: deps.ctx.channelId, mailbox: deps.mailbox, buyer: idres.buyer }).channelId;
      session.channelId = channelId;
    } catch (err) {
      systemError = "store";
      step(errorStep("identify", err instanceof Error ? err.message : String(err)));
    }
  }
  if (!systemError) {
    try {
      const prior = session.extracted;
      // On a reply, only the newest message: quoted history would re-read the old lines.
      const source = prior ? { ...safe, bodyText: newest } : safe;
      const extraction = await deps.extract(source, { priorExtraction: prior, buyerReply: prior ? newest : undefined });
      extracted = extraction.extracted;
      session.extracted = extracted;
      step(extractedStep(extracted, inbound, Boolean(prior)));
      await tokens(extraction.usage);
    } catch (err) {
      systemError = "model";
      step(errorStep("extract", err instanceof Error ? err.message : String(err)));
    }
  }
  if (!systemError && extracted) {
    try {
      if (idres?.buyer) {
        const ev = await evaluate(
          { ctx: deps.ctx, config: deps.config },
          { idres, channelId, channelAmbiguous: false, channelAccessDenied: false, extracted, clarificationRounds: 0 },
        );
        resolved = ev.resolved;
        issues = ev.issues;
        defaultShipTo = ev.defaultShipTo;
      } else {
        resolved = await evaluateCatalog({ ctx: deps.ctx, config: deps.config }, { extracted, channelId });
      }
      session.resolution = resolved;
      session.validation = issues;
      // The catalog and price lookups, so the trail shows what was searched and what came back.
      if (extracted.lines.length) {
        const buyer = idres?.buyer;
        const pricedFor = buyer ? `${buyer.companyName || `company #${buyer.companyId}`}'s account pricing` : "guest pricing";
        step(resolvedStep(resolved));
        step(pricedStep(resolved, deps.config, now(), pricedFor));
      }
    } catch (err) {
      systemError = "store";
      step(errorStep("resolve", err instanceof Error ? err.message : String(err)));
    }
  }

  const known = Boolean(idres?.buyer);
  // A reply to our question answers what we asked; it stays answered for the thread.
  if (priorAction === "CLARIFY" && (classification.followUp === "answer" || classification.followUp === "accept")) {
    const asked = ANSWERABLE.filter((s) => priorRecord?.matched_scenarios.includes(s));
    rules.answered = [...new Set([...(rules.answered ?? []), ...asked])];
  }
  const input: RulesInput = {
    classification,
    sender: { email: safe.from, staff: isStaffSender(safe.from, deps.rules), freeDomain: isFreeDomain(safe.from) },
    customer: {
      kind: known ? "known" : "guest",
      accountHold: issues.some((i) => i.kind === "credit_hold" || i.kind === "company_not_approved") || (known && !idres!.companyApproved),
    },
    extracted: extracted ?? { poNumber: null, buyerNote: null, paymentIntent: "unspecified", requestedShipDate: null, shipTo: null, billTo: null, lines: [], currency: null, confidence: "low" },
    resolved,
    newShipTo: newShipTo(extracted, known, defaultShipTo),
    hasAttachments: safe.attachments.length > 0,
    requestTotal: estimatedSubtotal(resolved),
    thread: {
      priorAction,
      humanOwned: rules.humanOwned,
      clarificationRoundsUsed: rules.clarificationRoundsUsed,
      hasQuote: Boolean(rules.quote?.checkoutUrl),
      answered: rules.answered ?? [],
    },
    systemError,
  };

  let outcome = decideByRules(input, deps.rules);
  step(rulesDecidedStep(outcome, deps.rules));

  // A quote reply needs a quote: create it in the store (reply mode only).
  let checkoutUrl: string | undefined;
  let quoteNumber: string | undefined;
  /** The quote the reply is about: created on this turn, or the one a resend points at. */
  let replyQuote: { quoteId: number; quoteNumber?: string } | undefined;
  const wantsQuote = (outcome.action === "AUTO_RESPOND" || outcome.action === "HOLD") && outcome.replyKind === "quote";
  if (wantsQuote && reply) {
    const res = await submitQuote(deps.ctx, {
      buyer: idres?.buyer ?? undefined,
      guest: idres?.buyer ? undefined : { email: safe.from },
      channelId,
      resolvedLines: resolved,
      poNumber: extracted?.poNumber ?? undefined,
      expiryDays: deps.rules.quoteExpiryDays,
      sandbox: true,
    }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : String(err) }));
    if (res.ok) {
      step(submittedStep({ kind: "quote", ok: true, quoteId: res.quoteId, quoteNumber: res.quoteNumber, checkoutUrl: res.checkoutUrl }));
      rules.quote = { quoteId: res.quoteId, quoteNumber: res.quoteNumber, checkoutUrl: res.checkoutUrl, quoteUrl: res.quoteUrl };
      session.result = { quoteId: res.quoteId, quoteNumber: res.quoteNumber, checkoutUrl: res.checkoutUrl, quoteUrl: res.quoteUrl };
      checkoutUrl = res.checkoutUrl;
      quoteNumber = res.quoteNumber;
      replyQuote = { quoteId: res.quoteId, quoteNumber: res.quoteNumber };
    } else {
      // T14: never send a quote the store didn't create.
      step(submittedStep({ kind: "quote", ok: false, reason: res.reason }));
      outcome = decideByRules({ ...input, systemError: "store" }, deps.rules);
      step(rulesDecidedStep(outcome, deps.rules));
    }
  } else if (outcome.replyKind === "resend_link") {
    checkoutUrl = rules.quote?.checkoutUrl;
    quoteNumber = rules.quote?.quoteNumber;
    replyQuote = rules.quote ? { quoteId: rules.quote.quoteId, quoteNumber: rules.quote.quoteNumber } : undefined;
  }

  // The reply.
  const subject = reSubject(safe.subject);
  const replyCtx: ReplyContext = {
    resolved,
    total: estimatedSubtotal(submittableLines(resolved)),
    poNumber: extracted?.poNumber ?? null,
    guest: !known,
    hits: outcome.scenarios,
    availability: classification.intent === "availability",
    shipTo: extracted?.shipTo,
    quoteNumber,
    checkoutUrl,
    preview: !reply,
    forStaff: input.sender.staff,
  };
  const text = draftRulesReply(outcome.replyKind, replyCtx);
  if (text && outcome.replyKind !== "none") {
    step(
      draftedStep({
        kind: outcome.replyKind,
        pricedLines: submittableLines(resolved).filter((l) => l.calculatedUnitPrice != null).length,
        total: replyCtx.total,
        questions: outcome.replyKind === "clarify" ? clarifyQuestions(replyCtx) : [],
        hits: outcome.scenarios,
        quote: replyQuote,
        checkoutLink: Boolean(checkoutUrl),
        availability: replyCtx.availability,
        preview: !reply,
        forStaff: input.sender.staff,
      }),
    );
  }

  if (outcome.action === "ESCALATE") {
    // The handoff to a sales agent; the customer is sent nothing.
    step(handoffStep(resolved.length, submittableLines(resolved).filter((l) => l.calculatedUnitPrice != null).length));
  }

  let sent: SessionMessage | null = null;
  let replyStatus: DecisionRecord["reply_status"] = text ? "preview" : "none";
  if (text && reply && outcome.replyKind !== "none") {
    const meta = { kind: "auto_reply" as const, purpose: PURPOSE[outcome.replyKind], from: deps.mailbox, run };
    const thread = threadFor(safe, subject);
    if (outcome.action === "HOLD") {
      sent = recordDraft(session, thread, { subject, text }, meta, now);
      step(heldDraftStep(sent));
      replyStatus = "held";
    } else {
      sent = await sendRecordedReply(deps.channel, session, thread, { subject, text }, meta, now);
      step(outboundStep(sent));
      replyStatus = sent.status === "failed" ? "none" : "sent";
    }
  }

  // State.
  if (reply) {
    switch (outcome.action) {
      case "AUTO_RESPOND":
        session.state = "completed_quote";
        break;
      case "CLARIFY":
        session.state = "clarifying";
        rules.clarificationRoundsUsed += 1;
        session.clarificationRounds = rules.clarificationRoundsUsed;
        break;
      case "HOLD":
        session.state = "held";
        break;
      case "ESCALATE":
        session.state = "escalated";
        rules.humanOwned = true;
        session.escalation = { reasons: outcome.reasonCodes, at: now(), notified: [] };
        break;
      case "NO_RESPONSE":
        if (priorState === "new") session.state = "rejected";
        break;
    }
    if (outcome.action !== "NO_RESPONSE") rules.lastAction = outcome.action;
  } else {
    session.state = "validating";
  }
  if (outcome.action !== "NO_RESPONSE" || priorState === "new") {
    session.decision = { kind: decisionKind(outcome), reasons: [outcome.action, ...outcome.reasonCodes] };
  }

  const buyer = idres?.buyer;
  const record = buildDecisionRecord({
    messageId: inbound.id,
    threadId: session.threadId,
    run,
    at: now(),
    outcome,
    classification,
    customer: {
      customerId: buyer?.customerId ?? null,
      company: buyer?.companyName ?? null,
      guest: !buyer,
      // The store gives no person name for a buyer; the email is how they are identified.
      name: safe.from,
      email: safe.from,
    },
    extracted: extracted ?? null,
    resolved,
    requestTotal: estimatedSubtotal(resolved),
    checkoutUrl: checkoutUrl ?? null,
    clarificationRoundsUsed: rules.clarificationRoundsUsed,
    reply: text && outcome.replyKind !== "none" ? { to: safe.from, subject, body: text } : null,
    replyStatus,
  });
  rules.records.push(record);
  if (rules.records.length > MAX_RECORDS) rules.records.splice(0, rules.records.length - MAX_RECORDS);

  if (reply) {
    session.updatedAt = now();
    await deps.store!.saveSession(session);
  }
  return { session, outcome, record };
}

/** The action a held draft carries out once a person approves it. */
export function actionForPurpose(purpose: MessagePurpose | undefined): RulesAction {
  return purpose === "clarification" ? "CLARIFY" : "AUTO_RESPOND";
}
