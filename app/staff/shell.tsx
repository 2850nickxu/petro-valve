"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge, Icon, PageBody, SidebarNav, StatusDot, type IconName } from "@/components/backbone";
import { LinkButton } from "@/components/ui/link-button";
import { VIEW_HOME, VIEW_LABEL, canSeeUsage, type AdminView } from "@/lib/po-agent/admin-view";
import styles from "./shell.module.css";

// The admin chrome, built on Backbone's fixed frame: a 232px sticky sidebar and a 48px
// sticky header at standard density, dropping to compact only inside data regions (each
// screen does that per table). Client-side because the burger and the sidebar share one
// open/closed state: at >=960px the sidebar is a static column; below that it is an
// off-canvas drawer over a scrim (the one piece Backbone has no primitive for — see
// shell.module.css).

export interface ShellStatus {
  /** Green when live, amber mid-setup, red when disabled. */
  tone: "ok" | "warn" | "bad";
  /** e.g. "live · gmail · anthropic:claude-sonnet-4-6" */
  label: string;
}

const STATUS_TONE: Record<ShellStatus["tone"], "success" | "warning" | "danger"> = {
  ok: "success",
  warn: "warning",
  bad: "danger",
};

interface NavRow {
  id: string;
  label: string;
  icon: IconName;
  trailing?: ReactNode;
}

/** Longest nav id the current path falls under, so a session-detail page (under
 * /staff/po-inbox) still highlights Inbox. */
function activeNavId(path: string, ids: string[]): string | undefined {
  const matches = ids.filter((id) => path.startsWith(id));
  return matches.sort((a, b) => b.length - a.length)[0];
}

export function AppShell({
  escalated,
  status,
  view,
  children,
}: {
  escalated: number;
  status: ShellStatus;
  /** Silk sees everything; the customer view drops Token usage. */
  view: AdminView;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();

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

  const sections: Array<{ label?: string; items: NavRow[] }> = [
    { label: "Overview", items: [{ id: VIEW_HOME[view], label: "Dashboard", icon: "home" }] },
    {
      label: "Work",
      items: [
        {
          id: "/staff/po-inbox",
          label: "Inbox",
          icon: "mail",
          trailing: escalated > 0 ? <Badge tone="danger" mono>{escalated}</Badge> : undefined,
        },
        { id: "/staff/sessions", label: "Sessions", icon: "layers" },
        { id: "/staff/simulator", label: "Simulator", icon: "build" },
      ],
    },
    {
      label: "Admin",
      items: [
        { id: "/staff/settings", label: "Settings", icon: "settings" },
        ...(canSeeUsage(view) ? [{ id: "/staff/usage", label: "Token usage", icon: "compare" as const }] : []),
      ],
    },
  ];

  const allIds = sections.flatMap((s) => s.items.map((i) => i.id));
  const activeId = activeNavId(path, allIds);

  return (
    <div className={styles.frame} data-density="standard">
      {menuOpen ? (
        <button type="button" className={styles.scrim} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
      ) : null}

      <aside className={`${styles.aside} ${menuOpen ? styles.asideOpen : ""}`}>
        <div style={{ flex: "1 1 auto", overflow: "auto", minHeight: 0 }}>
          <SidebarNav
            label="Admin sections"
            sections={sections}
            activeId={activeId}
            onSelect={(id) => {
              router.push(id);
              setMenuOpen(false);
            }}
          />
        </div>
        <a
          href="/api/staff/signout"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2-5)",
            height: "var(--nav-item-h)",
            padding: "0 16px",
            borderTop: "var(--border-w) solid var(--border-subtle)",
            color: "var(--text-secondary)",
            fontSize: "var(--text-body-size)",
            textDecoration: "none",
            flex: "0 0 auto",
          }}
        >
          <Icon name="subdir" size={16} />
          Sign out
        </a>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.burger}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" size={18} />
          </button>

          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            PO Agent
          </span>
          {/* Which view this is, so a screenshot shared with the customer is never ambiguous. */}
          <Badge tone={view === "silk" ? "inverse" : "neutral"}>{VIEW_LABEL[view]}</Badge>

          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
            <StatusDot tone={STATUS_TONE[status.tone]} label={status.label} halo={status.tone === "ok"} />
            <LinkButton href="/staff/simulator" variant="secondary" size="default" icon="build">
              Try the simulator
            </LinkButton>
          </span>
        </header>

        <main className={styles.content}>
          <PageBody>{children}</PageBody>
        </main>
      </div>
    </div>
  );
}
