import type { ReactNode } from "react";
import { isValidElement } from "react";
import Link from "next/link";
import { Badge, Box, Button, Flex, H1, Panel, Small, Text } from "@bigcommerce/big-design";
import type { Colors } from "@bigcommerce/big-design-theme";
import { badgeVariant } from "@/lib/ui/badge-variant";

// Server-safe presentational primitives shared by the admin screens, built on Big Design.

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" marginBottom="medium">
      <Box>
        <H1>{title}</H1>
        {sub ? (
          <Text color="secondary60" marginTop="xxSmall">
            {sub}
          </Text>
        ) : null}
      </Box>
      {children ? <Flex alignItems="center">{children}</Flex> : null}
    </Flex>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
  compact,
  hint,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "ok" | "bad";
  compact?: boolean;
  hint?: string;
}) {
  const color: keyof Colors = tone === "bad" ? "danger" : tone === "ok" ? "success" : "secondary70";
  return (
    <Panel title={hint}>
      <Text color="secondary60" bold marginBottom="xxSmall">
        {label}
      </Text>
      <Text
        color={color}
        style={{ fontSize: compact ? 24 : 28, fontWeight: 600, lineHeight: 1, marginTop: compact ? 8 : undefined }}
      >
        {value}
      </Text>
      {note ? (
        <Text color="secondary60" marginTop="xxSmall">
          {note}
        </Text>
      ) : null}
    </Panel>
  );
}

/** Best-effort extraction of a plain-text label from arbitrary chip content — Big
 * Design's Badge only accepts a string `label`, unlike the old chip which took any node. */
function chipLabel(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(chipLabel).join("");
  if (isValidElement(node)) return chipLabel((node.props as { children?: ReactNode }).children);
  return "";
}

/** State/decision chip. `kind` maps to the session state or decision kind. */
export function Chip({ kind, children }: { kind?: string; size?: "lg" | "sm"; children?: ReactNode }) {
  const label = chipLabel(children) || kind || "—";
  return <Badge label={label} variant={badgeVariant(kind ?? "neutral")} />;
}

export function CardHead({ title, children }: { title: ReactNode; sm?: boolean; children?: ReactNode }) {
  return (
    <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" marginBottom="small" style={{ gap: 10 }}>
      <Text bold marginBottom="none">
        {title}
      </Text>
      {children}
    </Flex>
  );
}

export function HealthRow({
  ok,
  warn,
  name,
  detail,
  action,
}: {
  ok: boolean;
  warn?: boolean;
  name: string;
  detail?: ReactNode;
  /** Shown as a "fix it" link when the item isn't OK. */
  action?: { label: string; href: string };
}) {
  const dot: keyof Colors = ok ? "success" : warn ? "warning" : "danger";
  return (
    <Flex alignItems="center" flexWrap="wrap" paddingVertical="small" style={{ gap: 10 }}>
      <Box backgroundColor={dot} borderRadius="circle" style={{ width: 8, height: 8, flex: "none" }} />
      <Box style={{ flex: "1 1 140px", minWidth: 0 }}>
        <Text bold marginBottom="none">
          {name}
        </Text>
      </Box>
      <Small color="secondary60" marginBottom="none">
        {detail}
      </Small>
      {!ok && action ? (
        <Link href={action.href}>
          <Button variant="subtle">{action.label}</Button>
        </Link>
      ) : null}
    </Flex>
  );
}

/** One clickable session line — used by the dashboard, inbox and sessions list. */
export function SessionRow({
  href,
  company,
  sub,
  meta,
  state,
  stateLabel: stateLabelProp,
  tint,
}: {
  href: string;
  company: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  state?: string;
  stateLabel?: string;
  tint?: "bad" | "warn";
}) {
  const bg: keyof Colors | undefined = tint === "bad" ? "danger10" : tint === "warn" ? "warning10" : undefined;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <Flex
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        backgroundColor={bg}
        padding="medium"
        style={{ gap: 10 }}
      >
        <Box style={{ flex: "1 1 230px", minWidth: 0 }}>
          <Text bold marginBottom="none">
            {company}
          </Text>
          {sub ? (
            <Small color="secondary60" marginBottom="none">
              {sub}
            </Small>
          ) : null}
        </Box>
        {meta ? (
          <Small color="secondary60" marginBottom="none">
            {meta}
          </Small>
        ) : null}
        {state ? <Chip kind={state}>{stateLabelProp ?? state}</Chip> : null}
      </Flex>
    </Link>
  );
}

/** Human label for a session state, matching the design's chip copy. */
export const STATE_LABEL: Record<string, string> = {
  new: "new",
  identifying: "identifying",
  validating: "validating",
  submitting: "submitting",
  clarifying: "clarifying",
  awaiting_confirmation: "awaiting confirm",
  completed_order: "order placed",
  completed_quote: "quote sent",
  escalated: "escalated",
  rejected: "rejected",
  expired: "expired",
};

export function stateLabel(state?: string): string {
  return (state && STATE_LABEL[state]) || state || "—";
}
