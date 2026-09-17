import type { ReactNode } from "react";

// Collapsible section — for raw JSON dumps and long audit logs that shouldn't dominate the
// default view. Backbone has no Collapse primitive; a native <details>/<summary> is
// server-safe, keyboard-accessible and needs no client JS. Styled from tokens only.

export function Disclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} style={{ border: "var(--border-w) solid var(--border-default)", borderRadius: "var(--radius-md)" }}>
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          padding: "var(--space-2-5) var(--space-4)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-subheading-size)",
          fontWeight: "var(--text-subheading-weight)",
          color: "var(--text-secondary)",
        }}
      >
        {title}
      </summary>
      <div style={{ padding: "0 var(--space-4) var(--space-4)" }}>{children}</div>
    </details>
  );
}
