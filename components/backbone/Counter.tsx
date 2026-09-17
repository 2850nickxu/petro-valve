import React from 'react';

export interface CounterProps {
  value: number | string;
  /** `inverse` for the count that matters (unread, selected); `neutral` otherwise. */
  tone?: 'neutral' | 'inverse';
  style?: React.CSSProperties;
}

export function Counter({ value, tone = 'neutral', style }: CounterProps) {
  const inverse = tone === 'inverse';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 6px',
        borderRadius: 'var(--radius-md)',
        background: inverse ? 'var(--gray-900)' : 'var(--surface-sunken)',
        border: 'var(--border-w) solid ' + (inverse ? 'var(--gray-900)' : 'var(--border-default)'),
        color: inverse ? 'var(--text-inverse)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 'var(--weight-medium)',
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {value}
    </span>
  );
}
