"use client";

import Link from "next/link";
import { useState, type ComponentProps, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/backbone";

// Navigation styled as a Backbone `Button` — one real, focusable `<a>`. Backbone's own
// Button renders a <button>, which is wrong for a link (invalid to nest, and a plain
// full-page anchor loses client routing), so this reproduces the Button token styles on a
// Next <Link>. It mirrors Button.jsx: same variants, same density-driven geometry, same
// 90ms hover, resolved entirely from CSS-variable tokens.

export type LinkButtonVariant = "primary" | "accent" | "secondary" | "ghost";
export type LinkButtonSize = "micro" | "default" | "large";

const SIZE: Record<LinkButtonSize, { h: string; padX: number; font: string; gap: number; icon: number }> = {
  micro: { h: "var(--control-h-micro)", padX: 10, font: "calc(var(--control-font-size) - 1px)", gap: 5, icon: 12 },
  default: { h: "var(--control-h-default)", padX: 14, font: "var(--control-font-size)", gap: 6, icon: 14 },
  large: { h: "var(--control-h-large)", padX: 18, font: "calc(var(--control-font-size) + 1px)", gap: 8, icon: 16 },
};

const VARIANT: Record<LinkButtonVariant, CSSProperties> = {
  primary: { background: "var(--control-primary-bg)", color: "var(--control-primary-fg)", borderColor: "var(--control-primary-bg)" },
  accent: { background: "var(--accent-solid)", color: "var(--accent-on-solid)", borderColor: "var(--accent-solid)" },
  secondary: { background: "var(--control-secondary-bg)", color: "var(--text-primary)", borderColor: "var(--control-secondary-border)" },
  ghost: { background: "transparent", color: "var(--text-secondary)", borderColor: "transparent" },
};

const HOVER: Record<LinkButtonVariant, CSSProperties> = {
  primary: { background: "var(--control-primary-bg-hover)", borderColor: "var(--control-primary-bg-hover)" },
  accent: { background: "var(--accent-solid-hover)", borderColor: "var(--accent-solid-hover)" },
  secondary: { background: "var(--surface-hover)", borderColor: "var(--border-hover)" },
  ghost: { background: "var(--control-ghost-bg-hover)", color: "var(--text-primary)" },
};

export type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  icon?: IconName;
  iconAfter?: IconName;
  block?: boolean;
};

export function LinkButton({
  variant = "primary",
  size = "default",
  icon,
  iconAfter,
  block = false,
  style,
  children,
  ...props
}: LinkButtonProps) {
  const [hover, setHover] = useState(false);
  const s = SIZE[size];
  const base: CSSProperties = {
    display: block ? "flex" : "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: s.gap,
    width: block ? "100%" : undefined,
    height: s.h,
    padding: `0 ${s.padX}px`,
    borderRadius: "var(--radius-md)",
    borderStyle: "solid",
    borderWidth: "var(--border-w)",
    fontFamily: "var(--font-ui)",
    fontSize: s.font,
    fontWeight: "var(--weight-medium)",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "background var(--dur-instant), border-color var(--dur-instant)",
    ...VARIANT[variant],
    ...(hover ? HOVER[variant] : null),
    ...style,
  };
  return (
    <Link
      {...props}
      style={base}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon ? <Icon name={icon} size={s.icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={s.icon} /> : null}
    </Link>
  );
}
