"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: "Operations", items: [["/staff", "Dashboard"], ["/staff/po-inbox", "Inbox"], ["/staff/sessions", "Sessions"]] },
  { label: "Tools", items: [["/staff/simulator", "Simulator"], ["/staff/usage", "Token usage"]] },
  { label: "Configuration", items: [["/staff/settings", "Settings"]] },
];

export function AdminNav({ escalated = 0 }: { escalated?: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/staff" ? path === "/staff" : path.startsWith(href));

  // Collapse the mobile menu after navigating.
  useEffect(() => { setOpen(false); }, [path]);

  return (
    <nav className="app-nav">
      <button type="button" className="nav-mobile-bar" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`disclosure-caret ${open ? "open" : ""}`}>▶</span>
        <span>Menu</span>
        {escalated > 0 ? <span className="nav-badge">{escalated}</span> : null}
      </button>
      <div className={`nav-groups ${open ? "open" : ""}`}>
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
      </div>
    </nav>
  );
}
