"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styled from "styled-components";
import { Badge, Small } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";

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

const NavGroup = styled.div`
  margin-bottom: ${theme.spacing.large};
`;

const NavItemLink = styled(Link)<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  font-size: 13.5px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  color: ${(p) => (p.$active ? theme.colors.primary : theme.colors.secondary70)};
  background: ${(p) => (p.$active ? theme.colors.primary10 : "transparent")};
  border-left: 3px solid ${(p) => (p.$active ? theme.colors.primary : "transparent")};
  cursor: pointer;
  text-decoration: none;

  &:hover {
    text-decoration: none;
    background: ${(p) => (p.$active ? theme.colors.primary10 : theme.colors.secondary10)};
  }
`;

const SignOutLink = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  font-size: 13.5px;
  font-weight: 500;
  color: ${theme.colors.secondary70};
  cursor: pointer;
  text-decoration: none;

  &:hover {
    text-decoration: none;
    background: ${theme.colors.secondary10};
  }
`;

export function AdminNav({ escalated = 0, onNavigate }: { escalated?: number; onNavigate?: () => void }) {
  const path = usePathname();

  // /staff matches exactly (it's the index); everything else matches its subtree, so a
  // session-detail page keeps Inbox highlighted.
  const isActive = (href: string) => (href === "/staff" ? path === "/staff" : path.startsWith(href));

  return (
    <nav aria-label="Admin sections">
      {GROUPS.map((group) => (
        <NavGroup key={group.label}>
          <Small bold uppercase color="secondary50" style={{ padding: "0 18px 7px", letterSpacing: "0.12em" }}>
            {group.label}
          </Small>
          {group.items.map((item) => {
            const active = isActive(item.href);
            const badge = item.badge === "escalated" && escalated > 0 ? escalated : null;
            return (
              <NavItemLink
                key={item.href}
                href={item.href}
                $active={active}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
                {badge != null ? <Badge label={String(badge)} variant="danger" /> : null}
              </NavItemLink>
            );
          })}
        </NavGroup>
      ))}

      {/* Sign-out lives at the foot of the nav rather than the header, which the design
          keeps to status + theme + the simulator CTA. */}
      <NavGroup>
        <SignOutLink href="/api/staff/signout">
          <span style={{ flex: 1 }}>Sign out</span>
        </SignOutLink>
      </NavGroup>
    </nav>
  );
}
