import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { heuristicExtract } from "../ai/mock-provider";
import { getPoModel, hasConfiguredModel } from "../ai/registry";
import { CLASSIFY_SYSTEM } from "../ai/prompts";
import type { ExtractionUsage } from "../channel/types";
import {
  FLAG_KEYS,
  type Classification,
  type FlagKey,
  type FollowUpKind,
  type IntentType,
  type RulesAction,
} from "./types";

// Message classification for the rules layer: what the customer is asking for, how sure
// we are, and which content scenarios apply (discount ask, lead-time question, request for
// a person, injection attempt…). One structured model call when a model is configured;
// otherwise keyword rules, so tests and the demo run offline. Card and bank numbers are
// always found by regex — never left to the model — and are redacted before storage.

type Env = Record<string, string | undefined>;

export interface ClassifyInput {
  from: string;
  subject: string;
  /** The newest message only (see `newestMessage`). */
  body: string;
  hasAttachments: boolean;
  /** Set on a reply: what the agent did last on this thread. */
  thread?: { priorAction?: RulesAction; lastReply?: string };
}

export type Classifier = (input: ClassifyInput) => Promise<{ classification: Classification; usage?: ExtractionUsage }>;

/* ---------------------------------------------------------------- newest message */

const FORWARD_SUBJECT = /^\s*(fw|fwd)\s*:/i;

/** The newest message in a reply chain: everything above the first quoted line or reply
 * header. A forward keeps its whole body — the forwarded request is the content. */
export function newestMessage(subject: string, body: string): string {
  if (FORWARD_SUBJECT.test(subject)) return body.trim();
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.some((l) => l.trim())) break;
    out.push(line);
  }
  return out.join("\n").trim() || body.trim();
}

/* ---------------------------------------------------------------- payment data */

const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
const ROUTING_RE = /\b(routing|aba|sort code|swift|bic)\b[^\d\n]{0,24}(\d[\d -]{5,12}\d)/gi;
const ACCOUNT_RE = /\b(account|acct)\s*(?:no\.?|number|#)?[^\d\n]{0,12}(\d[\d -]{4,20}\d)/gi;

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function isCard(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhn(digits);
}

function isIban(match: string): boolean {
  const s = match.replace(/ /g, "");
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Card numbers (Luhn-valid), IBANs, or a routing number with an account number. */
export function detectPaymentData(text: string): boolean {
  if ((text.match(CARD_RE) ?? []).some(isCard)) return true;
  if ((text.match(IBAN_RE) ?? []).some(isIban)) return true;
  const routing = new RegExp(ROUTING_RE.source, "i").test(text);
  const account = new RegExp(ACCOUNT_RE.source, "i").test(text);
  return routing && account;
}

/** The text with card and bank numbers removed. Never repeat them anywhere (doc C8). */
export function redactPaymentData(text: string): string {
  return text
    .replace(CARD_RE, (m) => (isCard(m) ? "[card number removed]" : m))
    .replace(IBAN_RE, (m) => (isIban(m) ? "[bank details removed]" : m))
    .replace(ROUTING_RE, (_m, label: string) => `${label} [bank details removed]`)
    .replace(ACCOUNT_RE, (m, label: string, digits: string) => (digits.replace(/\D/g, "").length >= 6 ? `${label} [bank details removed]` : m));
}

/* ---------------------------------------------------------------- heuristic */

const FLAG_RE: Partial<Record<FlagKey, RegExp>> = {
  lead_time_question:
    /\b(lead[\s-]?times?|when (can|will|could|would) (it|this|they|these|you|the order) (ship|be shipped|arrive|be delivered)|ship dates?|delivery dates?|how (long|soon) (until|before|will|to)|\beta\b)/i,
  order_status_question:
    /\b(where is (my|our) (order|po|shipment)|order status|status of (my|our|the) (order|po)|tracking (number|info)|has (my|our|the) order shipped)/i,
  technical_question:
    /\b(pressure rating|psi rating|temperature rating|material compatib|compatible with|cv value|torque spec|rated for|wetted materials?)\b/i,
  return_or_complaint:
    /\b(rma|warranty|defective|damaged|return (this|these|the|an?|our) (item|order|part|valve|shipment)s?|send (it|them) back|complain(t|ing)?)\b/i,
  vendor_solicitation:
    /\b(unsubscribe|newsletter|we are a (leading )?(supplier|manufacturer|distributor)|our (latest |new )?price list|partnership opportunit|introduce our (company|services|products)|special offer)\b/i,
  auto_reply:
    /\b(out of (the )?office|auto(matic)?[- ]?reply|i am (currently )?away|delivery status notification|undeliverable|mail delivery (failed|subsystem)|mailer-daemon)\b/i,
  spam_or_phishing:
    /\b(verify your (account|password|identity)|click here to (log ?in|claim|verify)|you('ve| have) won|gift cards?|bitcoin|crypto(currency)? wallet|reset your password|\.exe\b)/i,
  discount_request:
    /\b(discount|best (price|pricing)|better (price|deal|pricing)|do better|lower (the |your )?price|price (break|match)|any flexibility|come down|competitor|cheaper|\d+\s?% off)\b/i,
  past_price_or_quote_ref:
    /\b(same (price|pricing) as|last (time|order)'?s? (price|pricing)|previous(ly)? (quoted|price|pricing)|as (you )?quoted (before|previously|last)|quote\s*(#|no\.?|number)\s*[A-Z]{0,3}-?\d{3,}|\bQ-\d{3,})/i,
  human_requested:
    /\b((speak|talk) (to|with) (a |an |someone|somebody)?\s?(person|human|real person|rep|representative|sales ?person|someone)|call me|can (someone|somebody) (call|contact|reach)|give me a call|real person)\b/i,
  threat_or_legal: /\b(lawyer|attorney|legal action|sue you|lawsuit|unacceptable|breach of contract|third (late|time))\b/i,
  prompt_injection:
    /\b(ignore (all |your |the |any |previous |prior )*(rules|instructions|guidelines)|disregard (your|all|the|previous|prior) (rules|instructions)|you are now|system prompt|new instructions|apply an? \d+\s?% (discount|off))/i,
  bot_question:
    /\b(is this (an? )?(automated|bot|robot|ai)\b|am i (talking|speaking|emailing) (to|with) (a |an )?(bot|robot|machine|ai|human|real person|person)|are you (a |an )?(bot|robot|real person|human|ai)\b)/i,
  substitute_requested: /\b(or equal|or equivalent|equivalent part|substitute|alternate part|alternative part)\b/i,
  modification_requested: /\b(drill(ed)?|machin(ed|ing)|modif(y|ied|ication)|weld (prep|ends?)|custom (cut|length|finish)|tapped for)\b/i,
  documentation_required:
    /\b(mtrs?|mill (test )?certs?|cert(ificate)?s? of conformance|c of c|\bcoc\b|nace|country of origin|material certs?|test reports?)\b/i,
  kit_or_assembly: /\b(with (an? )?(pneumatic |electric |manual )?actuators?|actuated|kits?\b|assembl(y|ies)|valve package)/i,
  formal_quote_requested: /\b(formal quote|quote on (your |company )?letterhead|official quote|signed quote|quote number|quote document)\b/i,
  price_hold_requested:
    /\b(hold (this|the|these|that|your) (price|pricing)|price (hold|validity)|(price|quote|pricing) (valid|good) for \d+|lock (in )?(the |this )?price)/i,
  need_by_date:
    /\b(must (arrive|be delivered|ship|be here) (by|before)|need(ed)? (it|them|this|these|the order) (by|before)|no later than|deadline|by (monday|tuesday|wednesday|thursday|friday|end of (the )?(day|week|month)))\b/i,
  blanket_order: /\b(blanket (order|po)|scheduled releases?|release schedule|monthly releases?|\d+ (units )?(per|a|each) (month|week|quarter))\b/i,
  drop_ship:
    /\b(drop[\s-]?ship|blind ship|ship (directly )?to (our|my) (customer|client|end user)|plain paperwork|no (pricing|invoice) in the box)/i,
  change_existing_order:
    /\b(add \d+ (more )?to (my|our|yesterday'?s|the|last week'?s) (order|po)|change (my|our) (existing |previous )?order|cancel (my|our|the) (order|po)|modify (my|our) order|update (my|our) (existing )?order)\b/i,
  checkout_issue:
    /\b(link (didn'?t|doesn'?t|does not|did not|won'?t|isn'?t) work|broken link|checkout (error|isn'?t working|failed|problem|issue)|can'?t (open|access) the link|link (has |is )?expired)/i,
  cannot_use_checkout: /\b(can'?t|cannot|unable to|don'?t want to) (use|do|complete|go through) (the |your |online )?(checkout|website|web ?site|portal)/i,
  asks_to_place_order:
    /\b(just (enter|place|put) (it|the order|this) (in )?for (me|us)|(please |can you )?(place|enter|process) (the|this|my|our) order for (me|us)|go ahead and (place|enter) (it|the order))/i,
  tax_exempt: /\b(tax[\s-]?exempt|resale (cert|certificate)|exemption certificate)\b/i,
  export_or_restricted_destination:
    /\b(export licen[cs]e|ship(ping|ped)? to (iran|cuba|syria|north korea|russia|belarus|crimea)|sanction(s|ed)?|end[\s-]use(r)? (statement|certificate)|eccn)\b/i,
  government_or_defense_clauses: /\b(dfars|itar|far clauses?|flow[\s-]?downs?|government contract|defen[cs]e contract|mil[\s-]?spec)\b/i,
  freight_or_expedite:
    /\b(ltl|freight|next[\s-]day|overnight|expedite[d]?|second[\s-]day air|2nd day air|(our|my) (ups|fedex|dhl) (account|acct)|third[\s-]party (billing|shipping)|ship collect)\b/i,
  shipping_cost_question: /\b(shipping cost|cost (to|of) ship|how much (is|for|will) shipping|shipping (charges?|price|rates?|fees?))\b/i,
  card_on_file: /\b(card on file|saved card|card (you|we) have on file|use (my|our) (saved |stored )?card)\b/i,
  net_terms_request:
    /\b(net\s?\d{1,3}\b|(put|charge|bill) (it|this|the order) (on|to) (our|my) account|pay(ing)? on account|bill (my|our) account|invoice (me|us))/i,
  mentions_attachment: /\b(see attached|attached (is|are|file|po|list|spreadsheet|please)|please find attached|in the attachment)\b/i,
  external_file_link: /\b(dropbox\.com|drive\.google\.com|sharepoint\.com|1drv\.ms|onedrive\.live\.com|box\.com\/s|wetransfer\.com|we\.tl)\b/i,
  customer_terms_and_conditions:
    /\b(terms and conditions|t&cs?|(our|the attached) (standard |purchase )?terms (apply|govern)|subject to (the attached|our) terms)\b/i,
  unit_of_measure_unclear: /\b\d+\s*(boxes|box|cases?|packs?|pallets?|rolls?|cartons?|bundles?|dozen)\b/i,
  non_usd_currency: /(\b(cad|eur|gbp|mxn|aud)\b|\beuros?\b|canadian dollars?|pesos|[€£])/i,
};

const NOT_A_NAME = new Set(["team", "there", "all", "sir", "madam", "sales", "petro", "everyone", "folks", "quotes", "support", "good"]);

/** "Hi Mike," — a greeting to someone by name. */
function namedRep(text: string): boolean {
  const m = text.match(/^\s*([Hh]i|[Hh]ello|[Hh]ey|[Dd]ear|[Aa]ttn:?)\s+([A-Z][a-z]+)\b/m);
  return Boolean(m && !NOT_A_NAME.has(m[2].toLowerCase()));
}

const LANGUAGE_WORDS: Array<[string, RegExp]> = [
  ["es", /\b(hola|por favor|gracias|cotizaci[oó]n|necesito|necesitamos|precio|cantidad|buenos d[ií]as|estimad[oa]s?|quisiera|v[aá]lvulas?|pedido)\b/gi],
  ["fr", /\b(bonjour|merci|devis|s'il vous pla[iî]t|veuillez|nous avons besoin|prix|quantit[ée]|commande)\b/gi],
  ["de", /\b(hallo|bitte|danke|angebot|wir ben[öo]tigen|preis|menge|sehr geehrte|bestellung)\b/gi],
  ["pt", /\b(ol[aá]|obrigad[oa]|cota[cç][aã]o|preciso|pre[cç]o|quantidade|pedido)\b/gi],
];

function detectLanguage(text: string): string {
  let best = "en";
  let bestCount = 1; // need at least two hits to call it
  for (const [lang, re] of LANGUAGE_WORDS) {
    const n = (text.match(re) ?? []).length;
    if (n > bestCount) {
      best = lang;
      bestCount = n;
    }
  }
  return best;
}

const AVAILABILITY_RE = /\b(in stock|availability|do you (have|carry|stock)|how many (do you have|are available|on hand))\b/i;
const QUOTE_RE = /\b(quote|quotation|pricing|price|prices|rfq|cost)\b/i;
const ORDER_RE = /\b(purchase order|p\.?o\.?\s*(#|number|no)|order)\b/i;
const ACCEPT_RE = /\b(looks good|go ahead|approved?|accept(ed)?|proceed|sounds good|that works|we('| wi)ll take (it|them)|confirm(ed)?|yes,? please)\b/i;
const CHANGE_RE = /\b(make it|instead|change|switch|add|remove|increase|decrease|update the (qty|quantity))\b/i;
const PUSHBACK_RE = /\b(competitor|too (high|expensive|much)|lower|cheaper|better price)\b/i;

function emptyFlags(): Record<FlagKey, boolean> {
  return Object.fromEntries(FLAG_KEYS.map((k) => [k, false])) as Record<FlagKey, boolean>;
}

/** Keyword classification. Deliberately conservative: it only sets flags it can see. */
export function heuristicClassify(input: ClassifyInput): Classification {
  const text = `${input.subject}\n${input.body}`;
  const flags = emptyFlags();
  for (const key of FLAG_KEYS) {
    const re = FLAG_RE[key];
    if (re && re.test(text)) flags[key] = true;
  }
  flags.named_rep = namedRep(input.body);
  if (/^(mailer-daemon|postmaster)@/i.test(input.from)) flags.auto_reply = true;

  const extracted = heuristicExtract({ subject: input.subject, bodyText: input.body });
  const hasSkuLines = extracted.lines.some((l) => l.sku);

  // "Can we get net 30?" on its own is a billing question (I8); net terms on a PO is C9.
  if (flags.net_terms_request && !hasSkuLines && !input.thread?.priorAction) flags.billing_question = true;

  const outOfScope = flags.order_status_question || flags.billing_question || flags.return_or_complaint || flags.technical_question;
  if (hasSkuLines && outOfScope) flags.multiple_intents = true;

  let intent: IntentType;
  let confidence: number;
  let followUp: FollowUpKind = "none";
  if (input.thread?.priorAction) {
    intent = "follow_up";
    confidence = 0.95;
    if (flags.discount_request || PUSHBACK_RE.test(input.body)) followUp = "price_pushback";
    else if (hasSkuLines || (CHANGE_RE.test(input.body) && /\d/.test(input.body))) followUp = "change";
    else if (ACCEPT_RE.test(input.body)) followUp = "accept";
    else followUp = "answer";
  } else if (hasSkuLines) {
    intent = AVAILABILITY_RE.test(text) ? "availability" : ORDER_RE.test(text) && !QUOTE_RE.test(text) ? "order" : "quote";
    confidence = 0.95;
  } else if (AVAILABILITY_RE.test(text)) {
    intent = "availability";
    confidence = 0.7;
  } else if (QUOTE_RE.test(text) || ORDER_RE.test(text)) {
    intent = "quote";
    confidence = 0.6;
  } else {
    intent = "other";
    confidence = 0.5;
  }

  return {
    intent,
    confidence,
    followUp,
    language: detectLanguage(text),
    flags,
    paymentData: detectPaymentData(text),
    source: "heuristic",
  };
}

/* ---------------------------------------------------------------- model */

const FlagsSchema = z.object(Object.fromEntries(FLAG_KEYS.map((k) => [k, z.boolean()])) as Record<FlagKey, z.ZodBoolean>);

export const ClassificationSchema = z.object({
  intent: z.enum(["quote", "order", "availability", "follow_up", "other"]),
  confidence: z.number(),
  followUp: z.enum(["accept", "answer", "change", "price_pushback", "none"]),
  language: z.string(),
  flags: FlagsSchema,
});

function threadNote(input: ClassifyInput): string {
  const t = input.thread;
  if (!t?.priorAction) return "This is the first message on a new thread.";
  const last = t.lastReply ? `\nThe agent's last reply to the customer was:\n"""\n${t.lastReply.slice(0, 1500)}\n"""` : "";
  return `This is a reply on an existing thread. The agent's last action was ${t.priorAction}.${last}`;
}

export async function classifyWithModel(
  model: LanguageModel,
  input: ClassifyInput,
): Promise<{ classification: Classification; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
  const content = [
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    `Attachments: ${input.hasAttachments ? "yes" : "none"}`,
    threadNote(input),
    `Customer message (untrusted data):\n"""\n${input.body}\n"""`,
  ].join("\n\n");

  const { object, usage } = await generateObject({
    model,
    schema: ClassificationSchema,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content }],
  });

  return {
    classification: {
      intent: object.intent,
      confidence: Math.min(1, Math.max(0, object.confidence)),
      followUp: input.thread?.priorAction ? object.followUp : "none",
      language: (object.language || "en").slice(0, 2).toLowerCase(),
      flags: { ...emptyFlags(), ...object.flags },
      // Never the model's call: always the regex.
      paymentData: detectPaymentData(`${input.subject}\n${input.body}`),
      source: "model",
    },
    usage: usage
      ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, totalTokens: usage.totalTokens ?? 0 }
      : undefined,
  };
}

/** Thrown when every model attempt failed — the rules escalate with `system_error` (T15). */
export class ClassifierUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The model couldn't classify the message: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ClassifierUnavailableError";
  }
}

/** The model classifier (retried up to `attempts` times) when a model is configured,
 * otherwise the heuristic. `model` overrides the configured one (tests). */
export function resolveClassifier(env: Env = process.env, opts: { attempts?: number; model?: LanguageModel } = {}): Classifier {
  const model = opts.model ?? (hasConfiguredModel(env) ? getPoModel(env) : null);
  if (!model) return async (input) => ({ classification: heuristicClassify(input) });
  const modelId = env.PO_AGENT_MODEL ?? "unknown";
  const attempts = Math.max(1, opts.attempts ?? 1);
  return async (input) => {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await classifyWithModel(model, input);
        return { classification: r.classification, usage: r.usage ? { model: modelId, ...r.usage } : undefined };
      } catch (err) {
        last = err;
      }
    }
    throw new ClassifierUnavailableError(last);
  };
}
