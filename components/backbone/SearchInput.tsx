"use client";
import React from 'react';
import { Icon } from './Icon';

export interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** filled in an app header, outlined in a toolbar. */
  variant?: 'outlined' | 'filled';
  width?: number | string;
  /** Accessible name. Defaults to "Search". */
  label?: string;
  onClear?: () => void;
  style?: React.CSSProperties;
}

export function SearchInput({
  value, onChange, placeholder = 'Search', variant = 'outlined', width,
  label = 'Search', onClear: _onClear, style, ...rest
}: SearchInputProps) {
  const filled = variant === 'filled';
  return (
    <span style={{ position: 'relative', display: 'flex', alignItems: 'center', width: width || '100%', ...style }}>
      <span aria-hidden="true" style={{ position: 'absolute', left: 11, display: 'flex', color: 'var(--text-muted)', pointerEvents: 'none' }}>
        <Icon name="search" size={15} />
      </span>
      <input
        type="search" role="searchbox" aria-label={label}
        value={value} onChange={onChange} placeholder={placeholder}
        style={{
          height: 'var(--control-h-default)', width: '100%', boxSizing: 'border-box',
          padding: '0 var(--field-pad-x) 0 34px',
          background: filled ? 'var(--control-filled-bg)' : 'var(--surface-panel)',
          border: 'var(--border-w) solid ' + (filled ? 'transparent' : 'var(--control-secondary-border)'),
          borderRadius: filled ? 'var(--radius-lg)' : 'var(--radius-md)',
          fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)', color: 'var(--text-primary)'
        }}
        {...rest}
      />
    </span>
  );
}
