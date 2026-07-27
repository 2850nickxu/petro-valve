"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: "Operations", items: [["/staff", "Dashboard"], ["/staff/po-inbox", "Inbox"], ["/staff/sessions", "Sessions"]] },
  { label: "Tools", items: [["/staff/simulator", "Simulator"], ["/staff/usage", "Token usage"]] },
  { label: "Configuration", items: [["/staff/settings", "Settings"]] },
];

export function AdminNav({ escalated = 0 }: { escalated?: number }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/staff" ? path === "/staff" : path.startsWith(href));

  return (
    <nav className="app-nav">
      {GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map(([href, label]) => (
            <Link key={href} href={href} className={`nav-item ${isActive(href) ? "active" : ""}`}>
              <span>{label}</span>
              {href === "/staff/po-inbox" && escalated > 0 ? <span className="nav-badge">{escalated}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
