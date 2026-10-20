"use client";
import React from 'react';
import { Icon } from './Icon';

/**
 * The overlay contract: role="dialog" aria-modal, labelled by its title,
 * Escape to dismiss, focus moved in on open and returned to the invoker on
 * close, Tab trapped inside the surface.
 */
export interface ModalProps {
  open?: boolean;
  title: string;
  /** Mono metadata line under the title — a record id, a count. */
  meta?: string;
  children?: React.ReactNode;
  /** Actions, right-aligned. The overlay may carry its own primary. */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  /** Id of an element that describes the dialog, if not the body. */
  describedBy?: string;
}

export interface CloseButtonProps {
  onClick?: () => void;
  size?: number;
  label?: string;
}

/* The overlay contract (the kit shares it with Drawer and CommandPalette):
   role="dialog" aria-modal, a label tied to the title, Escape to dismiss,
   focus moved in on open and returned to the invoker on close, and Tab wrapped
   inside the surface. Overlays appear; they do not animate in. */
export function useOverlay(
  open: boolean,
  onClose: (() => void) | undefined,
  surfaceRef: React.RefObject<HTMLElement | null>
): void {
  const restore = React.useRef<Element | null>(null);
  React.useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement;
    const surface = surfaceRef.current;
    const focusables = () => Array.prototype.filter.call(
      surface ? surface.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') : [],
      (el: HTMLElement) => el.offsetParent !== null
    );
    const first = focusables()[0];
    if (first) first.focus();
    else if (surface) { surface.setAttribute('tabindex', '-1'); surface.focus(); }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (onClose) onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const a = list[0], z = list[list.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      const back = restore.current as HTMLElement | null;
      if (back && back.focus) back.focus();
    };
  }, [open, onClose, surfaceRef]);
}

let seq = 0;
export function useOverlayIds(prefix: string): { title: string; desc: string } {
  return React.useMemo(() => {
    seq += 1;
    return { title: prefix + '-title-' + seq, desc: prefix + '-desc-' + seq };
  }, [prefix]);
}

export function Modal({ open = true, title, meta, children, footer, onClose, width = 460, describedBy }: ModalProps) {
  const surface = React.useRef<HTMLDivElement>(null);
  const ids = useOverlayIds('bb-modal');
  useOverlay(open, onClose, surface);
  if (!open) return null;
  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget && onClose) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'var(--overlay-scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)'
      }}
    >
      <div
        ref={surface} role="dialog" aria-modal="true" aria-labelledby={ids.title}
        aria-describedby={describedBy || ids.desc}
        style={{
          width: '100%', maxWidth: width, maxHeight: '100%', overflow: 'auto',
          background: 'var(--surface-panel)',
          border: 'var(--border-w) solid var(--border-default)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column'
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 'var(--space-4)', padding: 'var(--space-5) var(--space-5) 0'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h2 id={ids.title} style={{
              margin: 0, fontFamily: 'var(--font-ui)', fontSize: 'var(--text-section-size)',
              lineHeight: 'var(--text-section-line)', fontWeight: 'var(--weight-semibold)',
              letterSpacing: '-0.01em', color: 'var(--text-primary)'
            }}>{title}</h2>
            {meta ? (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption-size)', color: 'var(--text-metadata)' }}>{meta}</span>
            ) : null}
          </div>
          {onClose ? <CloseButton onClick={onClose} /> : null}
        </div>
        <div id={ids.desc} style={{
          padding: 'var(--space-3) var(--space-5) var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--gap-within)',
          fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)',
          lineHeight: 'var(--text-body-line)', color: 'var(--text-secondary)'
        }}>{children}</div>
        {footer ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-5)', borderTop: 'var(--border-w) solid var(--border-subtle)',
            background: 'var(--surface-page)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)'
          }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function CloseButton({ onClick, size = 28, label = 'Close' }: CloseButtonProps) {
  const [hover, setHover] = React.useState<boolean>(false);
  return (
    <button
      type="button" aria-label={label} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size,
        flex: '0 0 auto',
        background: hover ? 'var(--control-ghost-bg-hover)' : 'transparent', border: 'none',
        borderRadius: 'var(--radius-md)', color: hover ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer'
      }}
    ><Icon name="cancel" size={15} /></button>
  );
}
