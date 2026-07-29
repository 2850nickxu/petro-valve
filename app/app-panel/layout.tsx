import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// Compact layout for the control-panel PANEL iframe (no admin nav). A slim branded header
// keeps it visually part of the same product inside the BigCommerce control panel.
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="app-gradient" />
      <div className="public-brand" style={{ padding: "10px 16px" }}>
        <img className="app-logo light" src="/silk-logo-color.svg" alt="Silk Commerce" style={{ height: 18 }} />
        <img className="app-logo dark" src="/silk-logo-white.svg" alt="" aria-hidden="true" style={{ height: 18 }} />
        <span className="app-divider" />
        <span className="app-title" style={{ fontSize: 13 }}>PO Agent</span>
      </div>
      <div style={{ padding: 16, maxWidth: 560 }}>{children}</div>
    </div>
  );
}
