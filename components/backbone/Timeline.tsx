import React from 'react';

export interface TimelineEvent {
  label: string;
  /** Time formatting is the product's decision: UTC on an operations screen, local on a record. */
  time?: string;
  /** Who did it, joined to the time with a middle dot. */
  meta?: string;
  /** Not yet happened — hollow dot, muted label. */
  pending?: boolean;
}

export interface TimelineProps {
  events: TimelineEvent[];
  style?: React.CSSProperties;
}

/* Activity on a record. `meta` carries who did it — the third line of a
   timeline entry, metadata ink. Time formatting is the product's decision:
   pass absolute UTC on an operations screen, a local date on a record. */
export function Timeline({ events = [], style }: TimelineProps) {
  return (
    <ol style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-within)', margin: 0, padding: 0, listStyle: 'none', ...style }}>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const pending = e.pending;
        return (
          <li key={e.label + i} style={{ display: 'flex', gap: 'var(--space-2-5)' }}>
            <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 5 }}>
              <span style={{
                width: 7, height: 7, borderRadius: 'var(--radius-full)', flex: '0 0 auto',
                background: pending ? 'var(--surface-panel)' : 'var(--series-1)',
                border: pending ? '1.5px solid var(--control-secondary-border)' : 'none'
              }} />
              {last ? null : <span style={{ width: 1, flex: '1 1 auto', minHeight: 18, background: 'var(--border-default)' }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: last ? 0 : 4, minWidth: 0 }}>
              <span style={{
                fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)',
                lineHeight: 'var(--text-body-line)',
                fontWeight: pending ? 'var(--weight-regular)' : 'var(--weight-medium)',
                color: pending ? 'var(--text-muted)' : 'var(--text-primary)'
              }}>{e.label}</span>
              {e.time || e.meta ? (
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
                  lineHeight: 'var(--text-caption-line)', color: 'var(--text-metadata)'
                }}>{[e.time, e.meta].filter(Boolean).join(' · ')}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
