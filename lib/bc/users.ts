import { b2bFetch } from "./b2b-client";
import type { StoreContext } from "./store-context";
import type { B2BUser } from "./types";

interface RawUser {
  id: number | string;
  firstName?: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  role?: string | number;
  customerId?: number | string;
  companyId?: number | string;
  companyRoleId?: number;
  companyRoleName?: string;
  channelList?: Array<{ channelId: number } | number>;
}

function mapChannelList(cl: RawUser["channelList"]): number[] {
  if (!Array.isArray(cl)) return [];
  return cl
    .map((c) => (typeof c === "number" ? c : c?.channelId))
    .filter((n): n is number => typeof n === "number");
}

export function mapUser(raw: RawUser): B2BUser {
  return {
    id: Number(raw.id),
    firstName: raw.firstName ?? "",
    lastName: raw.lastName ?? "",
    email: raw.email,
    phoneNumber: raw.phoneNumber,
    // `role` is a string enum on the wire ("0"/"1"/"2"); companyRoleId overrides it.
    role: typeof raw.role === "string" ? parseInt(raw.role, 10) || 0 : raw.role ?? 0,
    customerId: Number(raw.customerId ?? 0),
    companyId: Number(raw.companyId ?? 0),
    companyRoleId: raw.companyRoleId,
    companyRoleName: raw.companyRoleName,
    channelList: mapChannelList(raw.channelList),
  };
}

/**
 * Exact-match lookup by email. Returns null only when B2B Edition answers with no match
 * (an empty `data` list); a failed call throws, so an outage is never read as "unknown
 * sender" and never gets a buyer rejected.
 */
export async function getUserByEmail(ctx: StoreContext, email: string): Promise<B2BUser | null> {
  const data = await b2bFetch<RawUser[] | { list?: RawUser[] }>(
    ctx,
    `/users?email=${encodeURIComponent(email)}&limit=1`,
  );
  const arr = Array.isArray(data) ? data : (data?.list ?? []);
  const raw = arr[0];
  return raw ? mapUser(raw) : null;
}
