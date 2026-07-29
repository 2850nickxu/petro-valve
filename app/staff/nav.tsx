"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar nav. Grouped Overview / Work / Admin per the design. Rendered inside the
// off-canvas panel on small screens, so every item closes the drawer on navigate.

const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string; badge?: "escalated" }> }> = [
  { label: "Overview", items: [{ href: "/staff", label: "Dashboard" }] },
  {
    label: "Work",
    items: [
      { href: "/staff/po-inbox", label: "Inbox", badge: "escalated" },
      { href: "/staff/sessions", label: "Sessions" },
      { href: "/staff/simulator", label: "Simulator" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/staff/settings", label: "Settings" },
      { href: "/staff/usage", label: "Token usage" },
    ],
  },
];

export function AdminNav({ escalated = 0, onNavigate }: { escalated?: number; onNavigate?: () => void }) {
  const path = usePathname();

  // /staff matches exactly (it's the index); everything else matches its subtree, so a
  // session-detail page keeps Inbox highlighted.
  const isActive = (href: string) => (href === "/staff" ? path === "/staff" : path.startsWith(href));

  return (
    <nav aria-label="Admin sections">
      {GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => {
            const badge = item.badge === "escalated" && escalated > 0 ? escalated : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive(item.href) ? "active" : ""}`}
                aria-current={isActive(item.href) ? "page" : undefined}
                onClick={onNavigate}
              >
                <span>{item.label}</span>
                {badge != null ? <span className="nav-badge">{badge}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}

      {/* Sign-out lives at the foot of the nav rather than the header, which the design
          keeps to status + theme + the simulator CTA. */}
      <div className="nav-group">
        <a className="nav-item" href="/api/staff/signout">
          <span>Sign out</span>
        </a>
      </div>
    </nav>
  );
}
