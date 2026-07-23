import { b2bFetch } from "./b2b-client";
import type { StoreContext } from "./store-context";
import type { CompanyPaymentMethod } from "./types";

// GET /companies/{companyId}/payments → the per-company payment-method switches.
// Envelope: standard `data[]` of { paymentId, code, paymentTitle, isEnabled }
// (verified via docs MCP — .../rest/b2b/management/payment).

interface RawPaymentMethod {
  paymentId?: number | string;
  id?: number | string;
  code?: string;
  paymentTitle?: string;
  title?: string;
  isEnabled?: boolean | number;
}

function mapMethod(raw: RawPaymentMethod): CompanyPaymentMethod {
  return {
    paymentId: Number(raw.paymentId ?? raw.id ?? 0),
    code: raw.code ?? "",
    paymentTitle: raw.paymentTitle ?? raw.title ?? "",
    isEnabled: raw.isEnabled === true || raw.isEnabled === 1,
  };
}

export async function getCompanyPaymentMethods(
  ctx: StoreContext,
  companyId: number,
): Promise<CompanyPaymentMethod[]> {
  try {
    const data = await b2bFetch<RawPaymentMethod[] | { list?: RawPaymentMethod[] }>(
      ctx,
      `/companies/${companyId}/payments`,
    );
    const arr = Array.isArray(data) ? data : (data?.list ?? []);
    return arr.map(mapMethod);
  } catch {
    return [];
  }
}

/**
 * True when the company has an ENABLED payment method whose code matches one of the
 * configured pay-on-account codes (case-insensitive). This is the pay-on-account gate.
 */
export function hasEnabledPaymentCode(
  methods: CompanyPaymentMethod[],
  codes: string[],
): boolean {
  const wanted = new Set(codes.map((c) => c.toLowerCase()));
  return methods.some((m) => m.isEnabled && wanted.has(m.code.toLowerCase()));
}
