// Pure state → Big Design Badge variant map. Kept React-free so it unit-tests under the
// node-env vitest suite. Consumed by app/staff/ui.tsx <Chip>.
export type BadgeVariant = "primary" | "secondary" | "success" | "warning" | "danger";

const VARIANT: Record<string, BadgeVariant> = {
  completed_order: "success",
  completed_quote: "success",
  order: "success",
  quote: "success",
  escalated: "danger",
  rejected: "danger",
  reject: "danger",
  escalate: "danger",
  clarifying: "warning",
  clarify: "warning",
  awaiting_confirmation: "warning",
  new: "primary",
  identifying: "primary",
  validating: "primary",
  submitting: "primary",
  expired: "secondary",
  neutral: "secondary",
};

export function badgeVariant(state: string): BadgeVariant {
  return VARIANT[state] ?? "secondary";
}
