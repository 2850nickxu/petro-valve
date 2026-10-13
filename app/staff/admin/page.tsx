import { Dashboard } from "../dashboard";

export const dynamic = "force-dynamic";

/** Silk admin view: the whole app, including token usage and AI model settings. */
export default function SilkAdminDashboard() {
  return <Dashboard view="silk" />;
}
