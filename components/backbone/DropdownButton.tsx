"use client";
import React from 'react';
import { Icon } from './Icon';
import type { SegmentedOption } from './SegmentedControl';
import type { IconName } from './Icon';

/**
 * Toolbar control that opens a popover list — filters, ranges, scopes.
 */
export interface DropdownButtonProps {
  /** Overrides the derived label (otherwise the selected option's label is shown). */
  label?: string;
  icon?: IconName;
  options: Array<string | SegmentedOption>;
  value?: string;
  onChange?: (value: string) => void;
  /** `outlined` in a bordered toolbar; `filled` in a borderless scoping panel. */
  variant?: 'outlined' | 'filled';
  /** Mono label — for date ranges and ids. */
  mono?: boolean;
  width?: number;
  style?: React.CSSProperties;
}

export function DropdownButton({
  label, icon, options = [], value, onChange, variant = 'outlined', mono = false, width = 222, style
}: DropdownButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const filled = variant === 'filled';
  const current = items.find(o => o.value === value);
  const text = label || (current ? current.label : (items[0] && items[0].label));
  return (
    <div style={{ position: 'relative', flex: '0 0 auto', ...style }}>
      <button
        type="button" onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: filled ? 6 : 7,
          height: filled ? 34 : 32, padding: filled ? '0 10px 0 12px' : '0 10px',
          borderRadius: filled ? 'var(--radius-lg)' : 'var(--radius-md)',
          border: 'var(--border-w) solid ' + (filled ? (open ? 'var(--control-secondary-border)' : 'transparent') : (hover ? 'var(--border-hover)' : 'var(--control-secondary-border)')),
          background: filled ? (open || hover ? 'var(--control-filled-bg-hover)' : 'var(--control-filled-bg)') : 'var(--surface-panel)',
          color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
          fontSize: filled ? 13 : 12, fontWeight: filled ? 'var(--weight-semibold)' : 'var(--weight-medium)',
          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background var(--dur-instant)'
        }}
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{text}</span>
        <Icon name={filled ? (open ? 'caret-up' : 'caret-down') : 'expand-more'} size={14} />
      </button>
      {open ? (
        <div style={{
          position: 'absolute', zIndex: 40, top: filled ? 38 : 36, left: 0, width,
          background: 'var(--surface-panel)', border: 'var(--border-w) solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)',
          padding: 6, display: 'flex', flexDirection: 'column', gap: filled ? 2 : 1
        }}>
          {items.map(o => {
            const on = o.value === value;
            return (
              <button
                key={o.value} type="button"
                onClick={() => { setOpen(false); onChange?.(o.value); }}
                style={{
                  display: 'flex', alignItems: 'center', width: '100%', height: filled ? 30 : 28,
                  padding: filled ? '0 9px' : '0 8px', borderRadius: 'var(--radius-md)', textAlign: 'left',
                  border: 'var(--border-w) solid ' + (on && filled ? 'var(--border-default)' : 'transparent'),
                  background: on ? 'var(--surface-selected)' : 'transparent',
                  fontFamily: 'var(--font-ui)', fontSize: filled ? 13 : 12,
                  fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                  color: on ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer'
                }}
              >{o.label}</button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
