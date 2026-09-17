"use client";
import React from 'react';
import { Icon } from './Icon';

export interface FilterChipProps {
  /** Field name, rendered 500 grey. */
  field: string;
  /** Applied value, rendered 600-weight. */
  value: string;
  /** Omit to render a read-only chip. */
  onRemove?: () => void;
  style?: React.CSSProperties;
}

export function FilterChip({ field, value, onRemove, style }: FilterChipProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 4px 0 8px',
      background: 'var(--surface-sunken)', border: 'var(--border-w) solid var(--border-default)',
      borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-ui)', fontSize: 11,
      color: 'var(--text-secondary)', ...style
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{field}</span>
      <span style={{ fontWeight: 'var(--weight-semibold)' }}>{value}</span>
      {onRemove ? (
        <button
          type="button" aria-label={'Remove ' + field + ' filter'} onClick={onRemove}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, border: 'none', borderRadius: 'var(--radius-md)',
            background: hover ? 'var(--gray-100)' : 'transparent',
            color: hover ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer'
          }}
        ><Icon name="cancel" size={12} /></button>
      ) : null}
    </span>
  );
}
