import React from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface BadgeProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'inverse' | 'draft';
  /** Leading 10px glyph — used for deltas (`arrow-up`) and state ticks. */
  icon?: IconName;
  /** Mono + tabular figures, for percentages and deltas. */
  mono?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const TONES = {
  neutral: { background: 'var(--surface-sunken)', border: 'var(--border-default)', color: 'var(--text-secondary)' },
  success: { background: 'var(--success-tint)', border: 'var(--success-line)', color: 'var(--success-600)' },
  warning: { background: 'var(--warning-tint)', border: 'var(--warning-line)', color: 'var(--warning-600)' },
  danger: { background: 'var(--danger-tint)', border: 'var(--danger-line)', color: 'var(--danger-600)' },
  info: { background: 'var(--info-tint)', border: 'var(--info-line)', color: 'var(--info-600)' },
  inverse: { background: 'var(--gray-900)', border: 'var(--gray-900)', color: 'var(--text-inverse)' },
  draft: { background: 'transparent', border: 'var(--control-secondary-border)', color: 'var(--text-muted)' }
};

export function Badge({ children, tone = 'neutral', icon, mono = false, style }: BadgeProps) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px',
      borderRadius: 'var(--radius-md)', background: t.background, color: t.color,
      border: 'var(--border-w) ' + (tone === 'draft' ? 'dashed ' : 'solid ') + t.border,
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
      fontSize: 11, fontWeight: mono ? 'var(--weight-medium)' : 'var(--weight-semibold)',
      fontVariantNumeric: mono ? 'tabular-nums' : 'normal', whiteSpace: 'nowrap', ...style
    }}>
      {icon ? <Icon name={icon} size={10} /> : null}{children}
    </span>
  );
}
