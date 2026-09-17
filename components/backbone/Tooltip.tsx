"use client";
import React from 'react';

export interface TooltipProps {
  /** One short line — no titles, no formatting, no interactive content. */
  label: string;
  placement?: 'top' | 'bottom';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Tooltip({ label, children, placement = 'top', style }: TooltipProps) {
  const [open, setOpen] = React.useState<boolean>(false);
  const pos: React.CSSProperties = placement === 'bottom'
    ? { top: '100%', marginTop: 6 }
    : { bottom: '100%', marginBottom: 6 };
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 30, ...pos,
          background: 'var(--surface-inverse)', color: 'var(--text-inverse)',
          fontFamily: 'var(--font-ui)', fontSize: 11, lineHeight: '16px',
          padding: '5px 8px', borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-tooltip)'
        }}>{label}</span>
      ) : null}
    </span>
  );
}
