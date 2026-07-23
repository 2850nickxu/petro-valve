import type { StoreContext } from "@/lib/bc/store-context";
import { placeTermsOrder, companyAddressToCheckout, type BcCheckoutAddress, type TermsOrderTotals } from "@/lib/bc/checkout";
import { finalizeTermsOrder, type FinalizeTermsResult } from "@/lib/bc/orders";
import { getCompanyAddresses, defaultBilling, defaultShipping } from "@/lib/bc/companies";
import { submittableLines } from "./resolve";
import type { Address, Buyer, ResolvedLine, ExtractedPo } from "../types";

function addressToCheckout(a: Address): BcCheckoutAddress {
  return {
    first_name: a.firstName ?? undefined,
    last_name: a.lastName ?? undefined,
    company: a.company ?? undefined,
    address1: a.line1 ?? undefined,
    address2: a.line2 ?? undefined,
    city: a.city ?? undefined,
    state_or_province: a.state ?? undefined,
    postal_code: a.zip ?? undefined,
    country_code: a.country ?? undefined,
    phone: a.phone ?? undefined,
    email: a.email ?? undefined,
  };
}

export interface SubmitOrderParams {
  buyer: Buyer;
  channelId: number;
  resolvedLines: ResolvedLine[];
  extracted: ExtractedPo;
  poNumber?: string;
  credit?: { limitPurchases: boolean; availableCredit: number } | null;
}

export type SubmitOrderResult =
  | { ok: true; orderId: number; totals: TermsOrderTotals; invoice: FinalizeTermsResult }
  | { ok: false; reason: string };

export async function submitOrder(ctx: StoreContext, params: SubmitOrderParams): Promise<SubmitOrderResult> {
  const items = submittableLines(params.resolvedLines).map((l) => ({
    productId: l.productId!,
    variantId: l.variantId,
    quantity: l.line.quantity ?? 1,
  }));
  if (!items.length) return { ok: false, reason: "no_items" };

  const addrs = await getCompanyAddresses(ctx, params.buyer.companyId);
  const billDefault = defaultBilling(addrs);
  const shipDefault = defaultShipping(addrs);

  const billing = params.extracted.billTo
    ? addressToCheckout(params.extracted.billTo)
    : billDefault
      ? companyAddressToCheckout(billDefault)
      : undefined;
  const shipping = params.extracted.shipTo
    ? addressToCheckout(params.extracted.shipTo)
    : shipDefault
      ? companyAddressToCheckout(shipDefault)
      : undefined;

  if (!billing || !shipping) return { ok: false, reason: "missing_address" };

  const placed = await placeTermsOrder(ctx, {
    customerId: params.buyer.customerId,
    companyId: params.buyer.companyId,
    channelId: params.channelId,
    lineItems: items,
    billing,
    shipping,
    poNumber: params.poNumber,
    credit: params.credit,
  });
  if (!placed.ok) return { ok: false, reason: placed.reason };

  const invoice = await finalizeTermsOrder(ctx, placed.orderId, {
    poNumber: params.poNumber,
    attempts: 6,
    delayMs: 1500,
  });

  return { ok: true, orderId: placed.orderId, totals: placed.totals, invoice };
}
