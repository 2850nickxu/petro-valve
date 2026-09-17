"use client";
import React from 'react';
import { Icon } from './Icon';

export interface CheckboxProps {
  checked?: boolean;
  /** Mixed selection — draws a bar instead of the tick. */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function Checkbox({ checked = false, indeterminate = false, onChange, label, disabled = false, style }: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <label
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-ui)', fontSize: 13,
        color: disabled ? 'var(--text-disabled)' : 'var(--text-secondary)', ...style
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, flex: '0 0 auto', borderRadius: 'var(--radius-lg)',
        border: 'var(--border-w) solid ' + (disabled ? 'var(--border-default)' : (on ? 'var(--gray-900)' : 'var(--control-secondary-border)')),
        background: disabled ? 'var(--surface-disabled)' : (on ? 'var(--gray-900)' : 'var(--surface-panel)'),
        color: 'var(--text-inverse)'
      }}>
        {indeterminate ? <span style={{ width: 8, height: 1.5, background: 'var(--gray-000)' }} />
          : checked ? <Icon name="done" size={11} /> : null}
      </span>
      {label}
    </label>
  );
}
