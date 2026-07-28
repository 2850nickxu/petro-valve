import { b2bFetch } from "./b2b-client";
import type { StoreContext } from "./store-context";

// Company notification recipients on the B2B Management API (same store token as everything
// else in lib/bc). Two natively-resolvable groups, keyed by companyId:
//   - Sales rep(s) = the company's assigned Super Admin(s):
//       GET /companies/{companyId}/super-admins
//       docs.bigcommerce.com/developer/api-reference/rest/b2b/management/super-admin/get-companies
//   - Company admin(s) = B2B users with the Admin role ("0"):
//       GET /users?companyId={id}&roles=0
//       docs.bigcommerce.com/developer/api-reference/rest/b2b/management/users/companies-users-list

export interface CompanyContact {
  email: string;
  firstName?: string;
  lastName?: string;
  source: "sales_rep" | "admin";
}

interface RawContact {
  email?: string;
  firstName?: string;
  lastName?: string;
}

// B2B list envelopes come as a bare array or `{ list: [...] }` (see parseB2BEnvelope).
function toList(data: unknown): RawContact[] {
  if (Array.isArray(data)) return data as RawContact[];
  const list = (data as { list?: RawContact[] } | null)?.list;
  return Array.isArray(list) ? list : [];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmail(v: string | undefined | null): v is string {
  return typeof v === "string" && EMAIL_RE.test(v);
}

function map(list: RawContact[], source: CompanyContact["source"]): CompanyContact[] {
  return list
    .filter((c) => isEmail(c.email))
    .map((c) => ({ email: c.email as string, firstName: c.firstName, lastName: c.lastName, source }));
}

/** Sales rep(s) — the Super Admin(s) assigned to the company. Empty on miss/error. */
export async function getCompanySuperAdmins(ctx: StoreContext, companyId: number): Promise<CompanyContact[]> {
  try {
    const data = await b2bFetch<RawContact[] | { list?: RawContact[] }>(
      ctx,
      `/companies/${companyId}/super-admins?limit=50`,
    );
    return map(toList(data), "sales_rep");
  } catch {
    return [];
  }
}

/** Company admin(s) — B2B users with the Admin role ("0"). Empty on miss/error. */
export async function getCompanyAdmins(ctx: StoreContext, companyId: number): Promise<CompanyContact[]> {
  try {
    const data = await b2bFetch<RawContact[] | { list?: RawContact[] }>(
      ctx,
      `/users?companyId=${companyId}&roles=0&limit=50`,
    );
    return map(toList(data), "admin");
  } catch {
    return [];
  }
}
