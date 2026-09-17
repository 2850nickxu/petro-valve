import React from 'react';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: string;
  tone?: 'neutral' | 'danger';
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  /** Only on variant="page" — a second, lower-emphasis way in. */
  secondaryAction?: React.ReactNode;
  /** inline inside a panel or table; page for first-run and onboarding. */
  variant?: 'inline' | 'page';
  style?: React.CSSProperties;
}

/* Two sizes, because an empty table cell and a first-run screen are not the
   same problem. `inline` sits inside a panel or table; `page` is the
   onboarding case and gets room, a body-sized explanation and up to two
   actions. Still no illustration and still no encouragement. */
export function EmptyState({
  icon = 'layers', tone = 'neutral', title, children, action, secondaryAction,
  variant = 'inline', style
}: EmptyStateProps) {
  const danger = tone === 'danger';
  const page = variant === 'page';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: page ? 'var(--space-3)' : 'var(--space-2-5)',
      padding: page ? 'var(--space-12) var(--space-6)' : 'var(--space-10) var(--space-6)',
      textAlign: 'center', ...style
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: page ? 44 : 36, height: page ? 44 : 36,
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-w) solid ' + (danger ? 'var(--danger-line)' : 'var(--border-default)'),
        background: danger ? 'var(--danger-tint)' : 'var(--surface-page)',
        color: danger ? 'var(--danger-500)' : 'var(--text-disabled)'
      }}><Icon name={icon as IconName} size={page ? 20 : 18} /></span>
      <span style={{
        fontFamily: 'var(--font-ui)',
        fontSize: page ? 'var(--text-section-size)' : 'var(--text-body-size)',
        lineHeight: page ? 'var(--text-section-line)' : 'var(--text-body-line)',
        fontWeight: 'var(--weight-semibold)',
        letterSpacing: page ? 'var(--text-section-tracking)' : 'normal',
        color: 'var(--text-primary)'
      }}>{title}</span>
      {children ? (
        <span style={{
          fontFamily: 'var(--font-ui)',
          fontSize: page ? 'var(--text-body-size)' : 'var(--text-caption-size)',
          lineHeight: page ? 'var(--text-body-line)' : 'var(--text-caption-line)',
          color: 'var(--text-secondary)', maxWidth: page ? '52ch' : '40ch'
        }}>{children}</span>
      ) : null}
      {action || secondaryAction ? (
        <div style={{ marginTop: 'var(--space-1)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
          {action}{secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
