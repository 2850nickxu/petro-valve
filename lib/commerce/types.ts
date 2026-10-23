// The commerce seam. The Petro Valve rules flow (lib/po-agent/rules/conversation.ts) talks to
// the store only through a CommerceAdapter, so one agent core runs on BigCommerce or Magento.
// Which adapter a deployment uses is configuration (PO_AGENT_COMMERCE), never a code fork.
// The BigCommerce B2B order pipeline (lib/po-agent/pipeline.ts) is BigCommerce-specific and
// keeps calling lib/bc directly.

import type { CommercePlatform } from "@/lib/po-agent/config";
import type { IdentifyResult } from "@/lib/po-agent/core/identify";
import type { ExtractedPo, ResolvedLine, ValidationIssue } from "@/lib/po-agent/types";

export type { CommercePlatform };

/** Who sent the request, as the store sees them, and which sales channel prices apply. */
export interface CommerceIdentity {
  idres: IdentifyResult;
  channelId: number;
}

export interface CommerceEvaluation {
  /** The request's lines matched and priced against the store. */
  resolved: ResolvedLine[];
  /** Account-level issues (credit hold, unapproved company, …). */
  issues: ValidationIssue[];
  /** The account's default ship-to, when it has one (C11). */
  defaultShipTo?: { line1?: string; zip?: string };
  /** Whose prices were read, for the decision trail: "guest pricing", "Acme's account pricing". */
  pricedFor: string;
}

export interface QuoteRequest {
  who: CommerceIdentity;
  /** The sender, for a guest quote. */
  email: string;
  resolved: ResolvedLine[];
  poNumber?: string;
  expiryDays: number;
  /** Tag what's created as a sandbox artifact (the simulator). */
  sandbox: boolean;
}

/** What a quote reply links to: a BigCommerce quote, or a Magento guest cart. */
export type CommerceQuote =
  | { ok: true; quoteId: number | string; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string }
  | { ok: false; reason: string };

export interface CommerceAdapter {
  platform: CommercePlatform;
  /** "BigCommerce" | "Magento", for copy in the trail and the UI. */
  label: string;
  /** False when the store can't tell customers apart yet, so every sender is a guest. */
  identifiesCustomers: boolean;
  identify(email: string, opts: { mailbox?: string }): Promise<CommerceIdentity>;
  evaluate(extracted: ExtractedPo, who: CommerceIdentity): Promise<CommerceEvaluation>;
  createQuote(req: QuoteRequest): Promise<CommerceQuote>;
}
