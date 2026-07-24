import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// Compact layout for the control-panel PANEL iframe (no admin nav).
export default function PanelLayout({ children }: { children: ReactNode }) {
  return <div style={{ padding: 16, maxWidth: 560 }}>{children}</div>;
}
