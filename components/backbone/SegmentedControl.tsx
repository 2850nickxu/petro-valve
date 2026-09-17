"use client";
import React from 'react';

/** One option in a SegmentedControl: a bare value, or a value/label pair. */
export type SegmentedOption = string | { value: string; label: string };

/** One choice among 2-4 short options. Selection takes the accent surface. */
export interface SegmentedControlProps {
  options: SegmentedOption[];
  value?: string;
  onChange?: (value: string) => void;
  /** Accessible name for the group. */
  label?: string;
  style?: React.CSSProperties;
}

/* A single choice among 2-4 short options. Selection takes the accent surface,
   so it reads as a product control rather than a generic toggle. */
export function SegmentedControl({ options = [], value, onChange, label = 'View', style }: SegmentedControlProps) {
  const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = value != null ? value : (items[0] && items[0].value);
  return (
    <div role="group" aria-label={label} style={{
      display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden', flex: '0 0 auto',
      border: 'var(--border-w) solid var(--control-secondary-border)', ...style
    }}>
      {items.map((o, i) => {
        const on = o.value === current;
        return (
          <button
            key={o.value} type="button" aria-pressed={on} onClick={() => onChange && onChange(o.value)}
            style={{
              height: 'var(--control-h-default)', padding: '0 12px', border: 'none',
              borderRight: i === items.length - 1 ? 'none' : 'var(--border-w) solid var(--control-secondary-border)',
              background: on ? 'var(--accent-surface)' : 'var(--surface-panel)',
              color: on ? 'var(--accent-on-surface)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-ui)', fontSize: 'var(--control-font-size)',
              fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)', cursor: 'pointer'
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}
