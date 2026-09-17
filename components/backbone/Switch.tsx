"use client";
import React from 'react';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Label sits left, control right — the row stretches to its container. */
  label?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function Switch({ checked = false, onChange, label, disabled = false, style }: SwitchProps) {
  return (
    <label
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13,
        color: disabled ? 'var(--text-disabled)' : 'var(--text-secondary)', ...style
      }}
    >
      {label ? <span>{label}</span> : null}
      <span style={{
        position: 'relative', flex: '0 0 auto', width: 32, height: 18, borderRadius: 'var(--radius-full)',
        transition: 'background var(--dur-fast)',
        background: disabled ? 'var(--surface-disabled)' : (checked ? 'var(--gray-900)' : 'var(--surface-panel)'),
        border: 'var(--border-w) solid ' + (disabled ? 'var(--border-default)' : (checked ? 'var(--gray-900)' : 'var(--control-secondary-border)'))
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2, width: 12, height: 12,
          borderRadius: 'var(--radius-full)', transition: 'left var(--dur-fast)',
          background: disabled ? 'var(--gray-200)' : (checked ? 'var(--gray-000)' : 'var(--gray-500)')
        }} />
      </span>
    </label>
  );
}
