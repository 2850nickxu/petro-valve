import React from 'react';
import { Icon, type IconName } from './Icon';

export interface ToastProps {
  tone?: 'success' | 'danger' | 'info';
  title: string;
  children?: React.ReactNode;
  /** A single recovery `Button` (micro size). */
  action?: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

export interface ToastStackProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const TONES = {
  success: { mark: 'var(--success-500)', icon: 'done' },
  danger: { mark: 'var(--danger-500)', icon: 'cancel' },
  info: { mark: 'var(--info-500)', icon: 'info' }
};

export function Toast({ tone = 'success', title, children, action, onDismiss, style }: ToastProps) {
  const t = TONES[tone] || TONES.success;
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '11px 12px', maxWidth: 340,
      background: 'var(--surface-panel)', border: 'var(--border-w) solid var(--border-default)',
      borderLeft: '2px solid ' + t.mark, borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-overlay)', ...style
    }}>
      <span style={{ color: t.mark, paddingTop: 1, display: 'flex' }}><Icon name={t.icon as IconName} size={15} /></span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: action ? 5 : 1, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>{title}</span>
        {children ? (
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, lineHeight: '18px', color: 'var(--text-tertiary)' }}>{children}</span>
        ) : null}
        {action ? <div style={{ display: 'flex', gap: 6 }}>{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button" aria-label="Dismiss" onClick={onDismiss}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'flex-start', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 1 }}
        ><Icon name="cancel" size={14} /></button>
      ) : null}
    </div>
  );
}

export function ToastStack({ children, style }: ToastStackProps) {
  return (
    <div style={{
      position: 'fixed', zIndex: 120, right: 20, bottom: 20,
      display: 'flex', flexDirection: 'column', gap: 8, ...style
    }}>{children}</div>
  );
}
