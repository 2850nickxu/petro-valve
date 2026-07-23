import { b2bFetch } from "./b2b-client";
import type { StoreContext } from "./store-context";

// B2B Edition order augmentation + terms-order finalization. Headless (Checkout V3)
// orders are NOT auto-invoiced by B2B Edition, so after placing a terms order we set the
// canonical B2B poNumber and create the invoice. finalizeTermsOrder is idempotent (reads
// existing poNumber/invoiceId before writing) and retries to absorb B2B sync lag.

export interface B2BOrderDetail {
  id: number; // B2B Edition order id (needed for invoice creation)
  bcOrderId: number | string;
  poNumber?: string | null;
  invoiceId?: number | null;
}

export type FinalizeTermsResult =
  | { status: "exists"; invoiceId: number }
  | { status: "created"; invoiceId: number; invoiceNumber: string }
  | { status: "pending" }
  | { status: "failed" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawB2BOrder {
  id?: number | string;
  bcOrderId?: number | string;
  poNumber?: string | null;
  invoiceId?: number | null;
}

export async function getB2BOrderByBcId(
  ctx: StoreContext,
  bcOrderId: number,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<B2BOrderDetail | null> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 700;
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = await b2bFetch<RawB2BOrder | null>(ctx, `/orders/${bcOrderId}`);
      if (raw && raw.id != null) {
        return {
          id: Number(raw.id),
          bcOrderId: raw.bcOrderId ?? bcOrderId,
          poNumber: raw.poNumber ?? null,
          invoiceId: raw.invoiceId ?? null,
        };
      }
    } catch {
      /* not synced yet */
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

export async function setB2BOrderPoNumber(
  ctx: StoreContext,
  bcOrderId: number,
  poNumber: string,
): Promise<boolean> {
  try {
    await b2bFetch(ctx, `/orders/${bcOrderId}`, {
      method: "PUT",
      body: JSON.stringify({ poNumber }),
    });
    return true;
  } catch {
    return false;
  }
}

interface RawInvoice {
  id?: number | string;
  invoiceId?: number | string;
  invoiceNumber?: number | string;
}

export async function createInvoiceFromOrder(
  ctx: StoreContext,
  b2bOrderId: number,
): Promise<{ invoiceId: number; invoiceNumber: string } | null> {
  try {
    const raw = await b2bFetch<RawInvoice | null>(ctx, `/ip/orders/${b2bOrderId}/invoices`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!raw) return null;
    const invoiceId = Number(raw.invoiceId ?? raw.id ?? 0);
    if (!invoiceId) return null;
    return { invoiceId, invoiceNumber: String(raw.invoiceNumber ?? invoiceId) };
  } catch {
    return null;
  }
}

/**
 * Idempotent: set the canonical B2B poNumber (only if provided and not already set) and
 * create the invoice (only if not already linked). Safe to call at place-time and again
 * on order-view to heal an order that hadn't yet synced to B2B Edition.
 */
export async function finalizeTermsOrder(
  ctx: StoreContext,
  bcOrderId: number,
  opts: { poNumber?: string; attempts?: number; delayMs?: number } = {},
): Promise<FinalizeTermsResult> {
  const order = await getB2BOrderByBcId(ctx, bcOrderId, {
    attempts: opts.attempts,
    delayMs: opts.delayMs,
  });
  if (!order) return { status: "pending" };

  if (opts.poNumber && !order.poNumber) {
    await setB2BOrderPoNumber(ctx, bcOrderId, opts.poNumber);
  }

  if (order.invoiceId) {
    return { status: "exists", invoiceId: order.invoiceId };
  }

  const created = await createInvoiceFromOrder(ctx, order.id);
  if (!created) return { status: "failed" };
  return { status: "created", invoiceId: created.invoiceId, invoiceNumber: created.invoiceNumber };
}
