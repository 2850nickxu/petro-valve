import React from 'react';

export interface SpinnerProps {
  size?: number;
  /** Optional 12px explanation to the right of the ring. */
  label?: string;
  style?: React.CSSProperties;
}

export function Spinner({ size = 16, label, style }: SpinnerProps) {
  const ring = (
    <span style={{
      display: 'inline-block', flex: '0 0 auto', width: size, height: size,
      border: (size > 14 ? 2 : 1.5) + 'px solid var(--border-default)',
      borderTopColor: 'var(--gray-900)', borderRadius: 'var(--radius-full)',
      animation: 'bb-spin var(--dur-spin) linear infinite'
    }} />
  );
  if (!label) return ring;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, ...style }}>
      {ring}
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-tertiary)' }}>{label}</span>
    </span>
  );
}
