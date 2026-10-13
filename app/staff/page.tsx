import { redirect } from "next/navigation";
import { currentAdminView } from "@/lib/bc-app/request-context";
import { VIEW_HOME } from "@/lib/po-agent/admin-view";

export const dynamic = "force-dynamic";

/** /staff opens the dashboard of whichever admin view was last picked (Silk by default). */
export default async function StaffIndex() {
  redirect(VIEW_HOME[await currentAdminView()]);
}
