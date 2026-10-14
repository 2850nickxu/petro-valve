// Pure state → Backbone Badge tone map. Kept React-free so it unit-tests under the
// node-env vitest suite. Consumed by app/staff/ui.tsx <Chip>.
//
// Backbone signal tones are a claim: success/warning/danger carry meaning; `info` is the
// neutral-blue used for in-flight pipeline states; `neutral` is the quiet default for
// terminal-but-uneventful states (expired) and anything unknown. `draft`/`inverse` are
// unused here.
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE: Record<string, BadgeTone> = {
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
  held: "warning",
  new: "info",
  identifying: "info",
  validating: "info",
  submitting: "info",
  expired: "neutral",
  neutral: "neutral",
};

export function badgeVariant(state: string): BadgeTone {
  return TONE[state] ?? "neutral";
}
