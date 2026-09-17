import React from 'react';
import { Icon } from './Icon';

export interface Step { label: string }

export interface StepperProps {
  steps: Array<string | Step>;
  /** Zero-based index of the current step; earlier steps get a tick. */
  current?: number;
  style?: React.CSSProperties;
}

export function Stepper({ steps = [], current = 0, style }: StepperProps) {
  const items: Step[] = steps.map(s => (typeof s === 'string' ? { label: s } : s));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', ...style }}>
      {items.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const on = done || active;
        return (
          <React.Fragment key={s.label}>
            {i > 0 ? (
              <div style={{ height: 1, width: 40, flex: '0 0 auto', marginTop: 11, background: i <= current ? 'var(--gray-900)' : 'var(--border-default)' }} />
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '1 1 0' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
                borderRadius: 'var(--radius-full)',
                background: on ? 'var(--gray-900)' : 'var(--surface-panel)',
                border: on ? 'none' : 'var(--border-w) solid var(--control-secondary-border)',
                color: on ? 'var(--text-inverse)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 'var(--weight-medium)'
              }}>{done ? <Icon name="done" size={12} /> : i + 1}</span>
              <span style={{
                fontFamily: 'var(--font-ui)', fontSize: 11, textAlign: 'center',
                fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                color: on ? 'var(--text-primary)' : 'var(--text-muted)'
              }}>{s.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
