"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminNav } from "./nav";
import { ThemeToggle } from "@/components/ui/theme-toggle";

// The admin chrome. Client-side because the header's burger and the sidebar share one
// open/closed state: at ≥960px the sidebar is a static column, below that it becomes an
// off-canvas drawer over a scrim.

export interface ShellStatus {
  /** Green when live, amber mid-setup, red when disabled. */
  tone: "ok" | "warn" | "bad";
  /** e.g. "live · gmail · anthropic:claude-sonnet-4-6" */
  label: string;
}

export function AppShell({
  escalated,
  status,
  children,
}: {
  escalated: number;
  status: ShellStatus;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const path = usePathname();

  // Close the drawer on route change and on Escape.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const dotColor = status.tone === "ok" ? "var(--ok-dot)" : status.tone === "warn" ? "var(--warn-dot)" : "var(--bad-dot)";

  return (
    <div className="app">
      <div className="app-gradient" />

      <header className="app-header">
        <button
          type="button"
          className="pa-burger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>

        {/* Two logos, one per theme — CSS picks via --logo-light / --logo-dark. */}
        <img className="app-logo light" src="/silk-logo-color.svg" alt="Silk Commerce" />
        <img className="app-logo dark" src="/silk-logo-white.svg" alt="" aria-hidden="true" />

        <span className="app-divider pa-hide-sm" />
        <span className="app-title pa-hide-sm">PO Agent</span>

        <div className="app-header-right">
          <span className="app-status pa-hide-sm">
            <span className="dot" style={{ background: dotColor }} />
            {status.label}
          </span>
          <ThemeToggle />
          <Link className="btn primary sm" href="/staff/simulator">
            Try the simulator
          </Link>
        </div>
      </header>

      <div className="app-body">
        {menuOpen && (
          <button type="button" className="pa-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
        )}

        <aside className={`pa-nav ${menuOpen ? "pa-open" : ""}`}>
          <AdminNav escalated={escalated} onNavigate={() => setMenuOpen(false)} />
        </aside>

        <main className="app-main">
          <div className="pa-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
