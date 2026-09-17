import React from 'react';
import { Icon, type IconName } from './Icon';

/** Danger and warning announce themselves (role="alert"); info and success do not. */
export interface InlineMessageProps {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  /** Override the announcement. Set false for a permanent notice present on first paint. */
  live?: boolean;
  style?: React.CSSProperties;
}

const TONES = {
  info: { bg: 'var(--info-tint)', line: 'var(--info-line)', mark: 'var(--info-500)', head: 'var(--info-deep)', body: 'var(--info-600)', icon: 'info' },
  warning: { bg: 'var(--warning-tint)', line: 'var(--warning-line)', mark: 'var(--warning-500)', head: 'var(--warning-deep)', body: 'var(--warning-600)', icon: 'help' },
  danger: { bg: 'var(--danger-tint)', line: 'var(--danger-line)', mark: 'var(--danger-500)', head: 'var(--danger-deep)', body: 'var(--danger-600)', icon: 'cancel' },
  success: { bg: 'var(--success-tint)', line: 'var(--success-line)', mark: 'var(--success-500)', head: 'var(--success-deep)', body: 'var(--success-600)', icon: 'done' }
};

/* Danger and warning announce themselves; info and success do not interrupt.
   Set `live={false}` when the message is present on first paint and is not
   news — a permanent notice at the top of a settings page, for instance. */
export function InlineMessage({ tone = 'info', title, children, actions, onDismiss, live, style }: InlineMessageProps) {
  const t = TONES[tone] || TONES.info;
  const urgent = tone === 'danger' || tone === 'warning';
  const announce = live == null ? urgent : live;
  return (
    <div
      role={announce ? 'alert' : undefined}
      style={{
        display: 'flex', gap: 'var(--space-2-5)',
        padding: 'var(--space-3) var(--space-4)', background: t.bg,
        border: 'var(--border-w) solid ' + t.line, borderRadius: 'var(--radius-md)', ...style
      }}
    >
      <span aria-hidden="true" style={{ color: t.mark, paddingTop: 2, display: 'flex', flex: '0 0 auto' }}><Icon name={t.icon as IconName} size={15} /></span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: actions ? 'var(--space-1-5)' : 2, minWidth: 0 }}>
        {title ? (
          <span style={{
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)',
            lineHeight: 'var(--text-body-line)', fontWeight: 'var(--weight-semibold)', color: t.head
          }}>{title}</span>
        ) : null}
        {children ? (
          <span style={{
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
            lineHeight: 'var(--text-caption-line)', color: t.body
          }}>{children}</span>
        ) : null}
        {actions ? <div style={{ display: 'flex', gap: 'var(--space-1-5)', paddingTop: 2, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button" aria-label="Dismiss" onClick={onDismiss}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'flex-start', background: 'transparent', border: 'none', color: t.body, cursor: 'pointer', padding: 1, flex: '0 0 auto' }}
        ><Icon name="cancel" size={14} /></button>
      ) : null}
    </div>
  );
}
