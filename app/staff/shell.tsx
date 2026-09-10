"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import styled from "styled-components";
import { Badge, Box, Flex, Text } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";
import { AdminNav } from "./nav";
import { LinkButton } from "@/components/ui/link-button";

// The admin chrome. Client-side because the header's burger and the sidebar share one
// open/closed state: at ≥960px the sidebar is a static column, below that it becomes an
// off-canvas drawer over a scrim.

export interface ShellStatus {
  /** Green when live, amber mid-setup, red when disabled. */
  tone: "ok" | "warn" | "bad";
  /** e.g. "live · gmail · anthropic:claude-sonnet-4-6" */
  label: string;
}

const STATUS_BADGE_VARIANT: Record<ShellStatus["tone"], "success" | "warning" | "danger"> = {
  ok: "success",
  warn: "warning",
  bad: "danger",
};

// Big Design has no off-canvas drawer / scrim / burger primitive, so those three pieces
// are a small local styled-components layer reading theme tokens. Everything else below
// uses Big Design components directly.

const Burger = styled.button`
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid ${theme.colors.secondary20};
  border-radius: ${theme.borderRadius.normal};
  background: ${theme.colors.white};
  color: ${theme.colors.secondary70};
  cursor: pointer;
  flex: none;
  padding: 0;

  @media (max-width: 959px) {
    display: inline-flex;
  }
`;

const Scrim = styled.button`
  display: none;
  border: none;
  padding: 0;

  @media (max-width: 959px) {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(4, 39, 45, 0.42);
    z-index: ${theme.zIndex.modalBackdrop};
  }
`;

const DrawerAside = styled.aside<{ $open: boolean }>`
  width: 216px;
  flex: none;
  background: ${theme.colors.white};
  border-right: 1px solid ${theme.colors.secondary20};
  padding: ${theme.spacing.large} 0 ${theme.spacing.xLarge};

  @media (max-width: 959px) {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: ${theme.zIndex.modal};
    transform: ${(p) => (p.$open ? "none" : "translateX(-105%)")};
    transition: transform 200ms ease;
    box-shadow: 0 0 44px rgba(4, 39, 45, 0.28);
    overflow-y: auto;
  }
`;

const HideOnSmall = styled.span`
  display: inline-flex;
  align-items: center;

  @media (max-width: 959px) {
    display: none !important;
  }
`;

const PageContent = styled.div`
  max-width: 1060px;
  margin: 0 auto;
  padding: 26px clamp(16px, 4vw, 36px) 72px;
`;

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

  return (
    <Flex flexDirection="column" backgroundColor="secondary10" style={{ minHeight: "100vh" }}>
      <Flex
        as="header"
        alignItems="center"
        backgroundColor="white"
        padding="medium"
        style={{ gap: 14, flex: "none", minWidth: 0, borderBottom: `1px solid ${theme.colors.secondary20}` }}
      >
        <Burger type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </Burger>

        <Text bold marginBottom="none" style={{ whiteSpace: "nowrap" }}>
          PO Agent
        </Text>

        <Flex alignItems="center" style={{ marginLeft: "auto", gap: 12, minWidth: 0 }}>
          <HideOnSmall>
            <Badge label={status.label} variant={STATUS_BADGE_VARIANT[status.tone]} />
          </HideOnSmall>
          <LinkButton href="/staff/simulator" variant="primary">Try the simulator</LinkButton>
        </Flex>
      </Flex>

      <Flex style={{ flex: 1, minHeight: 0 }}>
        {menuOpen && (
          <Scrim type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
        )}

        <DrawerAside $open={menuOpen}>
          <AdminNav escalated={escalated} onNavigate={() => setMenuOpen(false)} />
        </DrawerAside>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <PageContent>{children}</PageContent>
        </Box>
      </Flex>
    </Flex>
  );
}
