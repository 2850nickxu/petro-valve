import { b2bFetch, isB2BStatus } from "./b2b-client";
import type { StoreContext } from "./store-context";
import type { B2BCompany, B2BCreditConfig, B2BPaymentTerms, B2BCompanyAddress } from "./types";

interface RawCompany {
  companyId?: number | string;
  id?: number | string;
  companyName?: string;
  companyEmail?: string;
  companyStatus?: number | string;
  bcGroupId?: number | string;
  bcGroupName?: string;
  priceListAssign?: Array<{ priceListId: number; channelId?: number }>;
  extraFields?: Array<{ fieldName: string; fieldValue: string }>;
  addressLine1?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
}

function mapCompany(raw: RawCompany): B2BCompany {
  return {
    companyId: Number(raw.companyId ?? raw.id ?? 0),
    companyName: raw.companyName ?? "",
    companyEmail: raw.companyEmail,
    companyStatus: Number(raw.companyStatus ?? 0),
    bcGroupId: raw.bcGroupId != null ? Number(raw.bcGroupId) : undefined,
    bcGroupName: raw.bcGroupName,
    priceListAssign: raw.priceListAssign,
    extraFields: raw.extraFields,
    addressLine1: raw.addressLine1,
    city: raw.city,
    state: raw.state,
    country: raw.country,
    zipCode: raw.zipCode,
  };
}

/** Null when the company doesn't exist (B2B Edition answers 404); any other failure throws. */
export async function getCompany(ctx: StoreContext, companyId: number): Promise<B2BCompany | null> {
  try {
    const raw = await b2bFetch<RawCompany | null>(ctx, `/companies/${companyId}`);
    return raw ? mapCompany(raw) : null;
  } catch (err) {
    if (isB2BStatus(err, 404)) return null;
    throw err;
  }
}

export const COMPANY_STATUS = {
  pending: 0,
  approved: 1,
  rejected: 2,
  inactive: 3,
} as const;

export function isCompanyApproved(company: B2BCompany | null): boolean {
  return company?.companyStatus === COMPANY_STATUS.approved;
}

interface RawCredit {
  creditEnabled?: boolean;
  creditCurrency?: string;
  availableCredit?: number | string;
  creditLimit?: number | string;
  limitPurchases?: boolean;
  creditHold?: boolean;
}

/**
 * Null when the store's company-credit feature is off (B2B Edition answers 400 for that);
 * any other failure throws, so an outage can't quietly turn pay-on-account off.
 */
export async function getCompanyCreditConfig(
  ctx: StoreContext,
  companyId: number,
): Promise<B2BCreditConfig | null> {
  try {
    const raw = await b2bFetch<RawCredit | null>(ctx, `/companies/${companyId}/credit`);
    if (!raw) return null;
    const availableCredit = Number(raw.availableCredit ?? raw.creditLimit ?? 0);
    return {
      creditEnabled: Boolean(raw.creditEnabled),
      creditCurrency: raw.creditCurrency,
      availableCredit,
      creditLimit: Number(raw.creditLimit ?? availableCredit),
      limitPurchases: Boolean(raw.limitPurchases),
      creditHold: Boolean(raw.creditHold),
    };
  } catch (err) {
    if (isB2BStatus(err, 400)) return null;
    throw err;
  }
}

export async function isCompanyOnCreditHold(ctx: StoreContext, companyId: number): Promise<boolean> {
  const credit = await getCompanyCreditConfig(ctx, companyId);
  return Boolean(credit?.creditEnabled && credit?.creditHold);
}

interface RawTerms {
  isEnabled?: boolean;
  paymentTermsDays?: number | string;
}

export async function getCompanyPaymentTerms(
  ctx: StoreContext,
  companyId: number,
): Promise<B2BPaymentTerms | null> {
  try {
    const raw = await b2bFetch<RawTerms | null>(ctx, `/companies/${companyId}/payment-terms`);
    if (!raw) return null;
    return {
      isEnabled: Boolean(raw.isEnabled),
      paymentTermsDays: Number(raw.paymentTermsDays ?? 0),
    };
  } catch {
    return null;
  }
}

interface RawAddress {
  addressId?: number | string;
  id?: number | string;
  label?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateName?: string;
  stateCode?: string;
  countryName?: string;
  countryCode?: string;
  zipCode?: string;
  isDefaultBilling?: boolean | number;
  isDefaultShipping?: boolean | number;
}

function truthy(v: boolean | number | undefined): boolean {
  return v === true || v === 1;
}

function mapAddress(raw: RawAddress): B2BCompanyAddress {
  return {
    addressId: Number(raw.addressId ?? raw.id ?? 0),
    label: raw.label,
    firstName: raw.firstName,
    lastName: raw.lastName,
    company: raw.company,
    phoneNumber: raw.phoneNumber,
    addressLine1: raw.addressLine1,
    addressLine2: raw.addressLine2,
    city: raw.city,
    stateName: raw.stateName,
    stateCode: raw.stateCode,
    countryName: raw.countryName,
    countryCode: raw.countryCode,
    zipCode: raw.zipCode,
    isDefaultBilling: truthy(raw.isDefaultBilling),
    isDefaultShipping: truthy(raw.isDefaultShipping),
  };
}

/** Throws on failure — an outage must not read as "no ship-to address". */
export async function getCompanyAddresses(
  ctx: StoreContext,
  companyId: number,
): Promise<B2BCompanyAddress[]> {
  const data = await b2bFetch<RawAddress[] | { list?: RawAddress[] }>(
    ctx,
    `/addresses?companyId=${companyId}&limit=250&isIncludeExtraFields=1`,
  );
  const arr = Array.isArray(data) ? data : (data?.list ?? []);
  return arr.map(mapAddress);
}

export function defaultBilling(addrs: B2BCompanyAddress[]): B2BCompanyAddress | undefined {
  return addrs.find((a) => a.isDefaultBilling) ?? addrs[0];
}
export function defaultShipping(addrs: B2BCompanyAddress[]): B2BCompanyAddress | undefined {
  return addrs.find((a) => a.isDefaultShipping) ?? addrs[0];
}
