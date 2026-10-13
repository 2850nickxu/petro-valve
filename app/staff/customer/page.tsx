import { Dashboard } from "../dashboard";

export const dynamic = "force-dynamic";

/** Customer admin view: no token usage, no AI model settings or model names. */
export default function CustomerAdminDashboard() {
  return <Dashboard view="customer" />;
}
