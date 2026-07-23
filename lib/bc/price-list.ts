import { bcFetchData } from "./bc-client";
import { getCompany } from "./companies";
import type { StoreContext } from "./store-context";

interface RawAssignment {
  price_list_id: number;
  customer_group_id?: number;
  channel_id?: number | null;
}

/**
 * Resolve a BC customer group → price list id. Prefers an assignment matching this
 * channel, then falls back to a channel-agnostic assignment (channel_id null).
 */
export async function getPriceListIdForCustomerGroup(
  ctx: StoreContext,
  customerGroupId: number,
): Promise<number | null> {
  if (!customerGroupId) return null;
  try {
    const assignments = await bcFetchData<RawAssignment[]>(
      ctx,
      `/v3/pricelists/assignments?customer_group_id=${customerGroupId}&limit=50`,
    );
    const forChannel = assignments.find((a) => a.channel_id === ctx.channelId);
    if (forChannel) return forChannel.price_list_id;
    const agnostic = assignments.find((a) => a.channel_id == null);
    return agnostic?.price_list_id ?? assignments[0]?.price_list_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Company-driven price list resolution (Independent Companies model), most-specific first:
 *   1) direct company assignment (priceListAssign[], matched to this channel)
 *   2) the company's bound BC customer group's price list
 */
export async function getPriceListIdForCompany(
  ctx: StoreContext,
  companyId: number,
): Promise<number | null> {
  const company = await getCompany(ctx, companyId);
  if (!company) return null;

  const assigns = company.priceListAssign ?? [];
  const forChannel = assigns.find((a) => a.channelId === ctx.channelId);
  if (forChannel) return forChannel.priceListId;
  const agnostic = assigns.find((a) => a.channelId == null);
  if (agnostic) return agnostic.priceListId;

  if (company.bcGroupId) {
    return await getPriceListIdForCustomerGroup(ctx, company.bcGroupId);
  }
  return null;
}
