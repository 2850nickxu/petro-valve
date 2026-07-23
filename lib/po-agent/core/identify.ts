import type { StoreContext } from "@/lib/bc/store-context";
import { getUserByEmail } from "@/lib/bc/users";
import { getCompany, isCompanyApproved } from "@/lib/bc/companies";
import type { B2BCompany } from "@/lib/bc/types";
import type { Buyer, ValidationIssueKind } from "../types";

// Sender email → B2B user → company → BC customer id / customer group. Never guesses a
// company from the email domain (unless explicitly allowed for a demo).

export interface IdentifyResult {
  buyer: Buyer | null;
  company: B2BCompany | null;
  companyApproved: boolean;
  issues: ValidationIssueKind[];
}

export async function identify(ctx: StoreContext, senderEmail: string): Promise<IdentifyResult> {
  const user = await getUserByEmail(ctx, senderEmail);
  if (!user) {
    return { buyer: null, company: null, companyApproved: false, issues: ["unknown_sender"] };
  }

  const company = await getCompany(ctx, user.companyId);
  const approved = isCompanyApproved(company);

  const buyer: Buyer = {
    email: user.email,
    b2bUserId: user.id,
    customerId: user.customerId,
    companyId: user.companyId,
    role: user.role,
    companyRoleName: user.companyRoleName,
    companyName: company?.companyName ?? "",
    customerGroupId: company?.bcGroupId,
    channelList: user.channelList,
  };

  const issues: ValidationIssueKind[] = [];
  if (!approved) issues.push("company_not_approved");

  return { buyer, company, companyApproved: approved, issues };
}
