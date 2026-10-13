// How serious a PO line's issues are, for row tint and label colour. Shared by the session
// page and the simulator so both screens agree. Pure.

export type LineSeverity = "bad" | "warn" | "ok";

/** Issues that stop the line from going through as written. */
const BAD = new Set([
  "line_unresolved",
  "line_parent_sku",
  "line_blocked_by_assortment",
  "line_sku_description_conflict",
  "price_mismatch",
]);

/** The worst issue on the line wins; any other issue reads as a warning. */
export function lineSeverity(issues: readonly string[]): LineSeverity {
  if (issues.some((i) => BAD.has(i))) return "bad";
  return issues.length ? "warn" : "ok";
}
