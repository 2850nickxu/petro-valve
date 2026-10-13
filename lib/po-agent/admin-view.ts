// Which admin view the app is showing: Silk's (everything) or the customer's (no token
// usage, no AI model settings, no model names). The view is picked on the dashboard —
// /staff/admin for Silk, /staff/customer for the customer — and remembered in a cookie so
// the rest of the app follows it. While the app is in testing anyone signed in can switch;
// what each view hides is still enforced on the server (pages and the settings API), not
// just left out of the menu. Pure and edge-safe: middleware imports it.

export type AdminView = "silk" | "customer";

export const VIEW_COOKIE = "poa_view";
/** Set by middleware on the request itself, so the page that switched the view renders it. */
export const VIEW_HEADER = "x-poa-view";

export const VIEW_HOME: Record<AdminView, string> = {
  silk: "/staff/admin",
  customer: "/staff/customer",
};

export const VIEW_LABEL: Record<AdminView, string> = {
  silk: "Silk admin",
  customer: "Customer admin",
};

/** Anything unrecognised is the Silk view — the one the app has always shown. */
export function parseView(v?: string | null): AdminView {
  return v === "customer" ? "customer" : "silk";
}

/** The view a path selects, if it is one of the two dashboards. */
export function viewForPath(pathname: string): AdminView | undefined {
  const p = pathname.replace(/\/+$/, "");
  if (p === VIEW_HOME.customer) return "customer";
  if (p === VIEW_HOME.silk) return "silk";
  return undefined;
}

/** Settings groups only Silk sees: the AI model, its provider keys. */
const SILK_ONLY_SETTING_GROUPS = new Set(["AI"]);

export function canSeeSettingGroup(view: AdminView, group: string): boolean {
  return view === "silk" || !SILK_ONLY_SETTING_GROUPS.has(group);
}

/** Token usage (calls, tokens, cost by model) is Silk's alone. */
export function canSeeUsage(view: AdminView): boolean {
  return view === "silk";
}

/** Model names and AI setup are Silk's alone. */
export function canSeeAiModel(view: AdminView): boolean {
  return view === "silk";
}
