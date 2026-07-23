import type { Buyer } from "../types";

// MSF channel resolution (§7.0). Single-storefront stores never notice this: the map is
// empty, the user's channelList matches (or is empty), and the fallback channel is used.
// Hard rule: if the resolved channel is not in the sender's channelList, we must NOT
// transact there — surface access-denied and clarify/escalate instead of using the token.

export interface ChannelResolution {
  channelId: number;
  ambiguous: boolean;
  accessDenied: boolean;
}

export interface ChannelResolveParams {
  channelMap: Record<string, number>;
  fallbackChannelId: number;
  mailbox?: string;
  buyer: Buyer | null;
}

export function resolveChannel(params: ChannelResolveParams): ChannelResolution {
  const { channelMap, fallbackChannelId, mailbox, buyer } = params;
  const channelList = buyer?.channelList ?? [];
  const mapped = mailbox != null ? channelMap[mailbox] : undefined;

  // 1) Mailbox pins the channel.
  if (mapped != null) {
    if (channelList.length && !channelList.includes(mapped)) {
      return { channelId: mapped, ambiguous: false, accessDenied: true };
    }
    return { channelId: mapped, ambiguous: false, accessDenied: false };
  }

  // 2) Sender's channel assignment.
  if (channelList.length === 1) {
    return { channelId: channelList[0], ambiguous: false, accessDenied: false };
  }
  if (channelList.length > 1) {
    if (channelList.includes(fallbackChannelId)) {
      return { channelId: fallbackChannelId, ambiguous: false, accessDenied: false };
    }
    // Assigned to several channels, none of them the default ⇒ ambiguous.
    return { channelId: channelList[0], ambiguous: true, accessDenied: false };
  }

  // 3) Fallback (single-storefront path).
  return { channelId: fallbackChannelId, ambiguous: false, accessDenied: false };
}
