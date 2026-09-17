"use client";
import React from 'react';

export interface RadioProps {
  checked?: boolean;
  onChange?: (checked: true) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function Radio({ checked = false, onChange, label, disabled = false, style }: RadioProps) {
  return (
    <label
      onClick={() => !disabled && onChange && onChange(true)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-ui)', fontSize: 13,
        color: disabled ? 'var(--text-disabled)' : 'var(--text-secondary)', ...style
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, flex: '0 0 auto', borderRadius: 'var(--radius-full)',
        border: 'var(--border-w) solid ' + (disabled ? 'var(--border-default)' : (checked ? 'var(--gray-900)' : 'var(--control-secondary-border)')),
        background: disabled ? 'var(--surface-disabled)' : 'var(--surface-panel)'
      }}>
        {checked ? <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: 'var(--gray-900)' }} /> : null}
      </span>
      {label}
    </label>
  );
}
