"use client";
import React from 'react';
import { CloseButton, useOverlay, useOverlayIds } from './Modal';

/** Same overlay contract as Modal: dialog semantics, Escape, focus trap and return. */
export interface DrawerProps {
  open?: boolean;
  title: string;
  meta?: string;
  /** A StatusDot or Badge beside the title. */
  status?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
}

export function Drawer({ open = true, title, meta, status, children, footer, onClose, width = 460 }: DrawerProps) {
  const surface = React.useRef<HTMLDivElement>(null);
  const ids = useOverlayIds('bb-drawer');
  useOverlay(open, onClose, surface);
  if (!open) return null;
  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget && onClose) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--overlay-scrim)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        ref={surface} role="dialog" aria-modal="true" aria-labelledby={ids.title}
        style={{
          width: '100%', maxWidth: width, height: '100%', background: 'var(--surface-panel)',
          borderLeft: 'var(--border-w) solid var(--border-default)', boxShadow: 'var(--shadow-drawer)',
          display: 'flex', flexDirection: 'column'
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)',
          padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--border-w) solid var(--border-default)'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {status}
              <h2 id={ids.title} style={{
                margin: 0, fontFamily: 'var(--font-ui)', fontSize: 'var(--text-section-size)',
                lineHeight: 'var(--text-section-line)', fontWeight: 'var(--weight-semibold)',
                letterSpacing: '-0.01em', color: 'var(--text-primary)'
              }}>{title}</h2>
            </div>
            {meta ? (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption-size)', color: 'var(--text-metadata)' }}>{meta}</span>
            ) : null}
          </div>
          {onClose ? <CloseButton onClick={onClose} /> : null}
        </div>
        <div style={{
          flex: '1 1 auto', overflow: 'auto', padding: 'var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--gap-group)'
        }}>{children}</div>
        {footer ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-5)',
            borderTop: 'var(--border-w) solid var(--border-default)', background: 'var(--surface-page)'
          }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
