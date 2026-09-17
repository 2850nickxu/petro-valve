import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// Compact layout for the control-panel PANEL iframe (no admin nav). A slim branded header
// keeps it visually part of the same product inside the BigCommerce control panel. Built on
// Backbone tokens so it matches the standalone console.
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: "var(--font-ui)", color: "var(--text-primary)", background: "var(--surface-page)", minHeight: "100vh" }}>
      <div
        style={{
          padding: "10px 16px",
          background: "var(--surface-panel)",
          borderBottom: "var(--border-w) solid var(--border-default)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>PO Agent</span>
      </div>
      <div style={{ padding: 16, maxWidth: 560 }}>{children}</div>
    </div>
  );
}
