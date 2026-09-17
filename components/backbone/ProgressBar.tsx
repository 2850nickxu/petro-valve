import React from 'react';

/** Only when a real percentage exists. There is no indeterminate mode. */
export interface ProgressBarProps {
  label?: string;
  value?: number;
  tone?: 'default' | 'warning' | 'danger';
  /** Pre-formatted value text — "873,410 of 1,284,903 rows saved". */
  valueLabel?: string;
  /** Mono figures. Use for identifiers and dense numeric views only. */
  mono?: boolean;
  style?: React.CSSProperties;
}

/* Only when a real percentage exists. There is no indeterminate mode — use a
   Spinner for work of unknown duration. */
export function ProgressBar({ label, value = 0, tone = 'default', valueLabel, mono = false, style }: ProgressBarProps) {
  const fill = tone === 'warning' ? 'var(--warning-500)' : tone === 'danger' ? 'var(--danger-500)' : 'var(--series-1)';
  const ink = tone === 'warning' ? 'var(--warning-600)' : tone === 'danger' ? 'var(--danger-600)' : 'var(--text-metadata)';
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', minWidth: 0, ...style }}>
      {(label || valueLabel) ? (
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)',
          fontSize: 'var(--text-caption-size)', lineHeight: 'var(--text-caption-line)', fontFamily: 'var(--font-ui)'
        }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 'var(--weight-medium)' }}>{label}</span>
          <span style={{
            fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
            fontVariantNumeric: 'var(--numeric-tabular)', color: ink, whiteSpace: 'nowrap'
          }}>{valueLabel != null ? valueLabel : pct + '%'}</span>
        </div>
      ) : null}
      <div
        role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        aria-label={label || undefined} aria-valuetext={valueLabel || undefined}
        style={{ height: 4, background: 'var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}
      >
        <div style={{ width: pct + '%', height: '100%', background: fill }} />
      </div>
    </div>
  );
}
