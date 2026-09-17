"use client";
import React from 'react';
import { Icon } from './Icon';

/* Shared field geometry. Every form control in the system reads from here, so
   a density change moves all of them and nothing carries a literal height. */
export const fieldLabel: React.CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
  lineHeight: 'var(--text-caption-line)', fontWeight: 'var(--weight-medium)',
  color: 'var(--text-secondary)'
};
export const fieldHelp: React.CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
  lineHeight: 'var(--text-caption-line)', color: 'var(--text-muted)'
};
export const fieldControl: React.CSSProperties = {
  height: 'var(--control-h-default)', padding: '0 var(--field-pad-x)',
  boxSizing: 'border-box', width: '100%',
  background: 'var(--surface-panel)', borderRadius: 'var(--radius-md)',
  border: 'var(--border-w) solid var(--control-secondary-border)',
  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)', color: 'var(--text-primary)'
};

export function useFieldIds(prefix: string): { input: string; help: string; error: string } {
  // React.useId() is stable across SSR and hydration; a module-level counter is not
  // (the server accumulates it across requests, so ids drift and the tree fails to hydrate).
  const uid = React.useId();
  return React.useMemo(() => {
    const base = prefix + '-' + uid;
    return { input: base, help: base + '-help', error: base + '-err' };
  }, [prefix, uid]);
}

/**
 * The field generates its own id, wires aria-describedby to help and error
 * text, sets aria-invalid, and puts the error in a role="alert". Consumers do
 * not pass ARIA by hand.
 */
export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  /** Supply only to tie an external <label> or to keep a stable id. */
  id?: string;
  help?: string;
  /** Presence switches the field to invalid and announces the message. */
  error?: string;
  /** Static text button-joined to the right edge — "seconds", "rows", ".com". */
  suffix?: React.ReactNode;
  /** Same, on the left — "https://", "$". */
  prefix?: React.ReactNode;
  /** Mono input for identifiers, endpoints and code. Not for ordinary numbers. */
  mono?: boolean;
  required?: boolean;
  /** Renders a quiet "optional" beside the label. Use one convention per form. */
  optional?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/** The shared label/control/description shell. Use when building a custom control. */
export interface FieldProps {
  id?: string;
  label?: string;
  help?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  ids: { input: string; help: string; error: string };
  children: (describedBy?: string) => React.ReactNode;
  style?: React.CSSProperties;
}

/* The label/control/description shell. `describedBy` is computed here rather
   than left to the consumer: a field with help text or an error always
   announces it, and an errored field always reports aria-invalid. */
export function Field({ id, label, help, error, required, optional, disabled, children, ids, style }: FieldProps) {
  const describedBy = [error ? ids.error : null, help ? ids.help : null].filter(Boolean).join(' ') || undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', minWidth: 0, ...style }}>
      {label ? (
        <label htmlFor={id} style={{ ...fieldLabel, color: disabled ? 'var(--text-disabled)' : fieldLabel.color }}>
          {label}
          {required ? <span aria-hidden="true" style={{ color: 'var(--danger-600)', marginLeft: 3 }}>*</span> : null}
          {optional ? <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)', marginLeft: 5 }}>optional</span> : null}
        </label>
      ) : null}
      {children(describedBy)}
      {error ? (
        <span id={ids.error} role="alert" style={{ ...fieldHelp, color: 'var(--danger-600)', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
          <Icon name="cancel" size={12} aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 2 }} />{error}
        </span>
      ) : null}
      {help ? (
        <span id={ids.help} style={{ ...fieldHelp, color: disabled ? 'var(--text-disabled)' : fieldHelp.color }}>{help}</span>
      ) : null}
    </div>
  );
}

export function TextField({
  id, label, value, onChange, placeholder, help, error, suffix, prefix, mono = false,
  required = false, optional = false, disabled = false, type = 'text', style, ...rest
}: TextFieldProps) {
  const ids = useFieldIds('bb-field');
  const inputId = id || ids.input;
  return (
    <Field id={inputId} label={label} help={help} error={error} required={required} optional={optional} disabled={disabled} ids={ids} style={style}>
      {describedBy => (
        <span style={{ display: 'flex', minWidth: 0 }}>
          {prefix ? <Affix side="start">{prefix}</Affix> : null}
          <input
            id={inputId} type={type} value={value} onChange={onChange} placeholder={placeholder}
            disabled={disabled} required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            style={{
              ...fieldControl,
              fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
              borderColor: error ? 'var(--danger-500)' : (disabled ? 'var(--border-default)' : 'var(--control-secondary-border)'),
              background: disabled ? 'var(--surface-disabled)' : 'var(--surface-panel)',
              color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
              ...(prefix ? { borderLeft: 'none', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 } : null),
              ...(suffix ? { borderRight: 'none', borderTopRightRadius: 0, borderBottomRightRadius: 0 } : null)
            }}
            {...rest}
          />
          {suffix ? <Affix side="end">{suffix}</Affix> : null}
        </span>
      )}
    </Field>
  );
}

function Affix({ side, children }: { side: 'start' | 'end'; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 'var(--control-h-default)',
      padding: '0 var(--field-pad-x)', boxSizing: 'border-box', flex: '0 0 auto',
      background: 'var(--surface-sunken)', border: 'var(--border-w) solid var(--control-secondary-border)',
      borderRadius: side === 'end' ? '0 var(--radius-md) var(--radius-md) 0' : 'var(--radius-md) 0 0 var(--radius-md)',
      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
      color: 'var(--text-tertiary)', whiteSpace: 'nowrap'
    }}>{children}</span>
  );
}
