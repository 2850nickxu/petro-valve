"use client";
import React from 'react';
import { Icon, type IconName } from './Icon';

/* Geometry comes from density tokens. `micro` is a toolbar/inline control,
   `default` is the application default, `large` is a form or empty-state
   action. Font size follows --control-font-size so a compact region gets
   compact buttons without a prop. */
const SIZES = {
  micro: { h: 'var(--control-h-micro)', padX: 10, font: 'calc(var(--control-font-size) - 1px)', gap: 5, icon: 12 },
  default: { h: 'var(--control-h-default)', padX: 14, font: 'var(--control-font-size)', gap: 6, icon: 14 },
  large: { h: 'var(--control-h-large)', padX: 18, font: 'calc(var(--control-font-size) + 1px)', gap: 8, icon: 16 }
};

const VARIANTS = {
  primary: { background: 'var(--control-primary-bg)', color: 'var(--control-primary-fg)', borderColor: 'var(--control-primary-bg)' },
  accent: { background: 'var(--accent-solid)', color: 'var(--accent-on-solid)', borderColor: 'var(--accent-solid)' },
  secondary: { background: 'var(--control-secondary-bg)', color: 'var(--text-primary)', borderColor: 'var(--control-secondary-border)' },
  ghost: { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'transparent' },
  destructive: { background: 'var(--control-secondary-bg)', color: 'var(--danger-600)', borderColor: 'var(--danger-line)' }
};

const HOVER = {
  primary: { background: 'var(--control-primary-bg-hover)', borderColor: 'var(--control-primary-bg-hover)' },
  accent: { background: 'var(--accent-solid-hover)', borderColor: 'var(--accent-solid-hover)' },
  secondary: { background: 'var(--surface-hover)', borderColor: 'var(--border-hover)' },
  ghost: { background: 'var(--control-ghost-bg-hover)', color: 'var(--text-primary)' },
  destructive: { background: 'var(--danger-tint)', borderColor: 'var(--danger-500)' }
};

/**
 * Geometry comes from density tokens: a compact region gets compact buttons
 * with no prop. A loading button is disabled and carries aria-busy.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = neutral 900 fill (default). accent = the product accent, a theme decision made once. */
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'destructive';
  /** micro in toolbars and rows, default everywhere, large for a form or empty-state action. */
  size?: 'micro' | 'default' | 'large';
  icon?: string;
  iconAfter?: string;
  /** Keeps the label, drops to 0.75 opacity, and is disabled while true. */
  loading?: boolean;
  disabled?: boolean;
  /** Full width — for a stacked form or a card action. */
  block?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Button({
  children, variant = 'primary', size = 'default', icon, iconAfter,
  disabled = false, loading = false, onClick, type = 'button', block = false, style, ...rest
}: ButtonProps) {
  const [hover, setHover] = React.useState(false);
  const s = SIZES[size] || SIZES.default;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const inert = disabled || loading;
  const base = {
    display: block ? 'flex' : 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap,
    width: block ? '100%' : undefined,
    height: s.h, padding: '0 ' + s.padX + 'px', borderRadius: 'var(--radius-md)',
    borderStyle: 'solid', borderWidth: 'var(--border-w)',
    fontFamily: 'var(--font-ui)', fontSize: s.font, fontWeight: 'var(--weight-medium)',
    cursor: loading ? 'progress' : disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
    transition: 'background var(--dur-instant), border-color var(--dur-instant)',
    ...v,
    ...(hover && !inert ? HOVER[variant] : null),
    ...(loading ? { opacity: 0.75 } : null),
    ...(disabled ? {
      background: 'var(--surface-disabled)', color: 'var(--text-disabled)',
      borderColor: 'var(--border-default)'
    } : null),
    ...style
  } as React.CSSProperties;
  return (
    <button
      type={type}
      /* A loading button is disabled: appearance alone never prevented a second
         submit. aria-busy announces the work; aria-disabled keeps it
         discoverable to screen readers while it is inert. */
      disabled={inert}
      aria-busy={loading || undefined}
      aria-disabled={inert || undefined}
      onClick={inert ? undefined : onClick}
      style={base}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      {...rest}
    >
      {loading ? <Spin light={variant === 'primary' || variant === 'accent'} /> : icon ? <Icon name={icon as IconName} size={s.icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter as IconName} size={s.icon} /> : null}
    </button>
  );
}

function Spin({ light }: { light: boolean }) {
  return (
    <span data-spinner aria-hidden="true" style={{
      display: 'inline-block', width: 12, height: 12, borderRadius: 'var(--radius-full)',
      border: '1.5px solid ' + (light ? 'rgba(255,255,255,0.35)' : 'var(--gray-100)'),
      borderTopColor: light ? 'var(--gray-000)' : 'var(--gray-900)',
      animation: 'bb-spin var(--dur-spin) linear infinite'
    }} />
  );
}
