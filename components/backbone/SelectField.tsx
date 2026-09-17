"use client";
import React from 'react';
import { Icon } from './Icon';
import { Field, useFieldIds, fieldControl } from './TextField';

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  id?: string;
  options: Array<string | { value: string; label: string }>;
  /** Renders a leading empty option — use for "not chosen yet", not as a label. */
  placeholder?: string;
  help?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function SelectField({
  id, label, value, onChange, options = [], help, error, placeholder,
  required = false, optional = false, disabled = false, style, ...rest
}: SelectFieldProps) {
  const ids = useFieldIds('bb-select');
  const selectId = id || ids.input;
  const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <Field id={selectId} label={label} help={help} error={error} required={required} optional={optional} disabled={disabled} ids={ids} style={style}>
      {describedBy => (
        <span style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
          <select
            id={selectId} value={value} onChange={onChange} disabled={disabled} required={required}
            aria-invalid={error ? true : undefined} aria-describedby={describedBy}
            style={{
              ...fieldControl,
              paddingRight: 30,
              borderColor: error ? 'var(--danger-500)' : (disabled ? 'var(--border-default)' : 'var(--control-secondary-border)'),
              background: disabled ? 'var(--surface-disabled)' : 'var(--surface-panel)',
              color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
              appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer'
            }}
            {...rest}
          >
            {placeholder ? <option value="">{placeholder}</option> : null}
            {items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span aria-hidden="true" style={{
            position: 'absolute', right: 9, top: 0, height: 'var(--control-h-default)',
            display: 'flex', alignItems: 'center', color: 'var(--text-muted)', pointerEvents: 'none'
          }}><Icon name="expand-more" size={14} /></span>
        </span>
      )}
    </Field>
  );
}
