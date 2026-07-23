import { bcFetch, bcFetchData } from "./bc-client";
import { createCart, type CartLineInput } from "./carts";
import type { StoreContext } from "./store-context";
import type { B2BCompanyAddress } from "./types";

// Session-free terms-order (pay-on-account) placement. This is the accelerator's
// express-checkout Checkout-V3 sequence, reimplemented to take explicit ids/addresses
// instead of a storefront session:
//   headless cart → billing-address → consignment (+ cheapest shipping) → read totals
//   → credit guard → place order → PUT v2 order {status 11, "Pay on Account"}.
// Invoice creation / canonical B2B poNumber is done by finalizeTermsOrder (orders.ts).

export interface BcCheckoutAddress {
  first_name?: string;
  last_name?: string;
  email?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state_or_province?: string;
  state_or_province_code?: string;
  postal_code?: string;
  country_code?: string;
  phone?: string;
}

interface BcShippingOption {
  id: string;
  cost: number;
  description: string;
}
interface BcConsignment {
  id: string;
  available_shipping_options?: BcShippingOption[];
}
interface BcCheckout {
  id: string;
  consignments?: BcConsignment[];
  grand_total?: number;
  subtotal_ex_tax?: number;
  subtotal_inc_tax?: number;
  tax_total?: number;
  shipping_cost_total_inc_tax?: number;
}

export interface TermsOrderTotals {
  subtotal: number;
  taxTotal: number;
  shippingTotal: number;
  grandTotal: number;
}

export interface TermsOrderParams {
  customerId: number;
  companyId: number;
  channelId?: number;
  lineItems: CartLineInput[];
  billing: BcCheckoutAddress;
  shipping: BcCheckoutAddress;
  poNumber?: string;
  /** Credit guard inputs; null/undefined ⇒ no cap enforced. */
  credit?: { limitPurchases: boolean; availableCredit: number } | null;
}

export type TermsOrderResult =
  | { ok: true; orderId: number; cartId: string; totals: TermsOrderTotals; shippingOption: string }
  | {
      ok: false;
      reason: "credit_exceeded" | "no_shipping_option" | "empty_cart" | "error";
      message?: string;
      totals?: TermsOrderTotals;
    };

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readTotals(c: BcCheckout): TermsOrderTotals {
  return {
    subtotal: num(c.subtotal_ex_tax ?? c.subtotal_inc_tax),
    taxTotal: num(c.tax_total),
    shippingTotal: num(c.shipping_cost_total_inc_tax),
    grandTotal: num(c.grand_total),
  };
}

/** Convert a B2B company address into a Checkout V3 address. */
export function companyAddressToCheckout(a: B2BCompanyAddress): BcCheckoutAddress {
  return {
    first_name: a.firstName,
    last_name: a.lastName,
    company: a.company,
    address1: a.addressLine1,
    address2: a.addressLine2,
    city: a.city,
    state_or_province: a.stateName,
    state_or_province_code: a.stateCode,
    postal_code: a.zipCode,
    country_code: a.countryCode,
    phone: a.phoneNumber,
  };
}

export async function placeTermsOrder(
  ctx: StoreContext,
  params: TermsOrderParams,
): Promise<TermsOrderResult> {
  const channelId = params.channelId ?? ctx.channelId;

  // 1) Headless cart owned by the buyer.
  const cart = await createCart(ctx, {
    customerId: params.customerId,
    channelId,
    lineItems: params.lineItems,
  });
  const physical = cart.line_items?.physical_items ?? [];
  if (!physical.length) return { ok: false, reason: "empty_cart" };
  const cartId = cart.id;

  // 2) Billing address.
  await bcFetch(ctx, `/v3/checkouts/${cartId}/billing-address`, {
    method: "POST",
    body: JSON.stringify(params.billing),
  });

  // 3) Consignment with shipping address + line items → available shipping options.
  const consignmentReq = [
    {
      address: params.shipping,
      line_items: physical.map((pi) => ({ item_id: pi.id, quantity: pi.quantity })),
    },
  ];
  const afterConsign = await bcFetchData<BcCheckout>(
    ctx,
    `/v3/checkouts/${cartId}/consignments?include=consignments.available_shipping_options`,
    { method: "POST", body: JSON.stringify(consignmentReq) },
  );
  const consignment = afterConsign.consignments?.[0];
  const options = consignment?.available_shipping_options ?? [];
  if (!consignment || !options.length) return { ok: false, reason: "no_shipping_option" };

  // 4) Select the cheapest shipping option (cost-driven, not carrier-driven).
  const cheapest = options.reduce((a, b) => (b.cost < a.cost ? b : a));
  const afterShip = await bcFetchData<BcCheckout>(
    ctx,
    `/v3/checkouts/${cartId}/consignments/${consignment.id}?include=consignments.available_shipping_options`,
    { method: "PUT", body: JSON.stringify({ shipping_option_id: cheapest.id }) },
  );

  // 5) Read back real totals.
  const totals = readTotals(afterShip);

  // 6) Credit guard — same rule as the storefront express flow.
  if (params.credit?.limitPurchases && totals.grandTotal > params.credit.availableCredit) {
    return { ok: false, reason: "credit_exceeded", totals };
  }

  // 7) Place the order.
  const order = await bcFetchData<{ id: number }>(ctx, `/v3/checkouts/${cartId}/orders`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const orderId = order.id;

  // 8) Mark it a terms order (V2 Orders API): Awaiting Fulfillment + Pay on Account.
  //    PO number is stashed in staff_notes (V2 rejects customer_po_number); the canonical
  //    B2B poNumber is set by finalizeTermsOrder.
  await bcFetch(ctx, `/v2/orders/${orderId}`, {
    method: "PUT",
    body: JSON.stringify({
      status_id: 11,
      payment_method: "Pay on Account",
      staff_notes: `PO agent${params.poNumber ? ` — PO: ${params.poNumber}` : ""}`,
    }),
  });

  return { ok: true, orderId, cartId, totals, shippingOption: cheapest.description };
}
