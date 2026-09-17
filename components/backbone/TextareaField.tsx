"use client";
import React from 'react';
import { Field, useFieldIds, fieldControl } from './TextField';

export interface TextareaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  id?: string;
  help?: string;
  error?: string;
  rows?: number;
  /** Adds a live "n / max" count to the help line. */
  maxLength?: number;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function TextareaField({
  id, label, value, onChange, placeholder, help, error, rows = 3, maxLength,
  required = false, optional = false, disabled = false, style, ...rest
}: TextareaFieldProps) {
  const ids = useFieldIds('bb-textarea');
  const areaId = id || ids.input;
  const count = maxLength != null && typeof value === 'string' ? value.length + ' / ' + maxLength : null;
  return (
    <Field
      id={areaId} label={label} error={error} required={required} optional={optional} disabled={disabled} ids={ids}
      help={count ? (help ? help + ' · ' + count : count) : help} style={style}
    >
      {describedBy => (
        <textarea
          id={areaId} rows={rows} value={value} onChange={onChange} placeholder={placeholder}
          disabled={disabled} required={required} maxLength={maxLength}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy}
          style={{
            ...fieldControl, height: 'auto',
            padding: 'var(--space-2) var(--field-pad-x)',
            lineHeight: 'var(--text-body-line)', resize: 'vertical',
            borderColor: error ? 'var(--danger-500)' : (disabled ? 'var(--border-default)' : 'var(--control-secondary-border)'),
            background: disabled ? 'var(--surface-disabled)' : 'var(--surface-panel)',
            color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)'
          }}
          {...rest}
        />
      )}
    </Field>
  );
}
