import type { ReactNode } from "react";
import { EmptyState as BbEmptyState, InlineMessage, type IconName } from "@/components/backbone";

// Server-safe presentational states, re-expressed on Backbone. Banner distinguishes a
// "backend is down" notice from an ordinary empty list; EmptyState/ErrorState give lists a
// consistent, non-alarming look. Backbone's InlineMessage and EmptyState are presentational
// (no client hooks), so these stay usable from server components.

const BANNER_TONE = {
  info: "info",
  warn: "warning",
  error: "danger",
  ok: "success",
} as const satisfies Record<string, "info" | "warning" | "danger" | "success">;

export function Banner({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "warn" | "error" | "ok";
  title?: ReactNode;
  children?: ReactNode;
}) {
  // InlineMessage's title is a string; a ReactNode title collapses into the body so callers
  // can still pass rich content.
  const stringTitle = typeof title === "string" ? title : undefined;
  return (
    <InlineMessage tone={BANNER_TONE[kind]} title={stringTitle} live={false}>
      {stringTitle == null && title != null ? title : null}
      {children}
    </InlineMessage>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <BbEmptyState variant="inline" icon={icon} title={typeof title === "string" ? title : String(title)}>
      {children}
    </BbEmptyState>
  );
}

export function ErrorState({ title = "Something went wrong", children }: { title?: string; children?: ReactNode }) {
  return (
    <BbEmptyState variant="inline" tone="danger" title={title}>
      {children}
    </BbEmptyState>
  );
}
