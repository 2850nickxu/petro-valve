"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<[string, string]> = [
  ["/staff", "Dashboard"],
  ["/staff/po-inbox", "Inbox"],
  ["/staff/sessions", "Sessions"],
  ["/staff/simulator", "Simulator"],
  ["/staff/settings", "Settings"],
];

export function AdminNav() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/staff" ? path === "/staff" : path.startsWith(href));
  return (
    <nav className="admin-nav">
      <div className="inner">
        <span className="brand">
          <span className="dot" /> PO Agent
        </span>
        <div className="links">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={isActive(href) ? "active" : ""}>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
