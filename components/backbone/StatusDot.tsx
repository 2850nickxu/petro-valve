import React from 'react';

/**
 * One live thing — 7px dot with a 3px halo. Use for something currently running,
 * connected or live. The state of a record is a `Badge`, including in a table
 * `State` column.
 */
export interface StatusDotProps {
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  /** The live-state word beside the dot. */
  label?: React.ReactNode;
  /** Drop the halo when the thing is not actively running. */
  halo?: boolean;
  style?: React.CSSProperties;
}

const TONES: Record<string, { dot: string; halo: string | null }> = {
  success: { dot: 'var(--success-500)', halo: 'rgba(22,163,74,0.14)' },
  warning: { dot: 'var(--warning-500)', halo: 'rgba(217,119,6,0.14)' },
  danger: { dot: 'var(--danger-500)', halo: 'rgba(220,38,38,0.14)' },
  info: { dot: 'var(--info-500)', halo: 'rgba(2,132,199,0.14)' },
  neutral: { dot: 'var(--gray-200)', halo: null },
};

export function StatusDot({ tone = 'neutral', label, halo = true, style }: StatusDotProps) {
  const t = TONES[tone] || TONES.neutral;
  const dot = (
    <span
      style={{
        width: 7,
        height: 7,
        flex: '0 0 auto',
        borderRadius: 'var(--radius-full)',
        background: t.dot,
        boxShadow: halo && t.halo ? '0 0 0 3px ' + t.halo : 'none',
      }}
    />
  );
  if (!label) return dot;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        color: tone === 'neutral' ? 'var(--text-muted)' : 'var(--text-secondary)',
        ...style,
      }}
    >
      {dot}
      {label}
    </span>
  );
}
