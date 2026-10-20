import React from 'react';
import { Icon } from './Icon';

/**
 * A metric in a summary strip.
 *
 * Direction and desirability are separate facts: `direction` draws the arrow,
 * `intent` colours it. A rise in failures points up and is `bad`. If
 * desirability is unknown, leave `intent` off and the delta stays neutral.
 */
export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  /** "of 40M", "rows/s" — caption ink beside the value. */
  unit?: string;
  /** Pre-formatted change, e.g. "12.4%" or "3 more than yesterday". */
  delta?: string;
  /** Which way the number moved. Draws the arrow only. */
  direction?: 'up' | 'down' | 'flat';
  /** Whether that movement is good. Colours the delta only. */
  intent?: 'good' | 'bad' | 'caution' | 'neutral';
  /** One line under the value — scope, reset date, denominator. */
  note?: string;
  /** Mono figures. Use for identifiers and dense numeric views, not for ordinary counts. */
  mono?: boolean;
  /** A small chart or legend under the value. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface KpiRowProps {
  children?: React.ReactNode;
  /**
   * `plain` (default): no enclosing border, cells separated by one rule — a
   * summary is context, not four competing objects.
   * `boxed`: the bordered strip. Use inside a panel body, or on a compact
   * console where the border does structural work.
   */
  variant?: 'plain' | 'boxed';
  /** Fix the column count. Omit to auto-fit at 170px minimum. */
  columns?: number;
  style?: React.CSSProperties;
}

/* Direction and desirability are separate facts. A 12% rise in rows ingested is
   good; a 12% rise in failed runs is bad. `direction` draws the arrow,
   `intent` colours it. If you do not pass `intent`, the delta stays neutral —
   which is the correct default for a metric whose desirability is unknown. */
const INTENTS = {
  good: 'var(--success-600)',
  bad: 'var(--danger-600)',
  caution: 'var(--warning-600)',
  neutral: 'var(--text-metadata)'
};

export function KpiCard({
  label, value, unit, delta, direction, intent = 'neutral', note, children,
  mono = false, style
}: KpiCardProps) {
  const ink = INTENTS[intent] || INTENTS.neutral;
  return (
    <div style={{
      boxSizing: 'border-box', minWidth: 0,
      padding: 'calc(var(--panel-pad) * 0.8) var(--panel-pad)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style
    }}>
      <span style={{
        fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
        lineHeight: 'var(--text-caption-line)', fontWeight: 'var(--weight-medium)',
        color: 'var(--text-metadata)'
      }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
          fontSize: 'var(--text-metric-size)', lineHeight: 'var(--text-metric-line)',
          fontWeight: 'var(--text-metric-weight)', letterSpacing: 'var(--text-metric-tracking)',
          fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)'
        }}>{value}</span>
        {unit ? (
          <span style={{
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
            color: 'var(--text-metadata)'
          }}>{unit}</span>
        ) : null}
        {delta ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-caption-size)', fontWeight: 'var(--weight-medium)',
            fontVariantNumeric: 'var(--numeric-tabular)', color: ink
          }}>
            {direction === 'up' || direction === 'down' ? (
              <Icon name="arrow-up" size={11} aria-hidden="true"
                style={direction === 'down' ? { transform: 'rotate(180deg)' } : undefined} />
            ) : null}
            {delta}
          </span>
        ) : null}
      </div>
      {children}
      {note ? (
        <span style={{
          fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
          lineHeight: 'var(--text-caption-line)', color: 'var(--text-metadata)'
        }}>{note}</span>
      ) : null}
    </div>
  );
}

/* Two treatments, and the quiet one is the default.

   `plain`  — a summary strip with no enclosing border, cells separated by a
              single rule. This is the standard-density default: a summary is
              context for the page, not four competing objects.
   `boxed`  — the original bordered row. Use it when the summary is a bounded
              object in its own right, e.g. inside a panel body or on a
              compact console where the border does structural work. */
export function KpiRow({ children, variant = 'plain', columns, style }: KpiRowProps) {
  const boxed = variant === 'boxed';
  const kids = React.Children.toArray(children);
  return (
    <div
      role="group"
      style={{
        display: 'grid',
        gridTemplateColumns: columns
          ? 'repeat(' + columns + ', minmax(0, 1fr))'
          : 'repeat(auto-fit, minmax(170px, 1fr))',
        background: boxed ? 'var(--surface-panel)' : 'transparent',
        border: boxed ? 'var(--border-w) solid var(--border-default)' : 'none',
        borderRadius: boxed ? 'var(--radius-md)' : 0,
        overflow: 'hidden', minWidth: 0, ...style
      }}
    >
      {kids.map((child, i) => (
        <div key={i} style={{
          minWidth: 0,
          borderLeft: i === 0 ? 'none' : 'var(--border-w) solid var(--border-default)',
          paddingLeft: !boxed && i === 0 ? 0 : undefined,
          marginLeft: !boxed && i === 0 ? 0 : undefined
        }}>{child}</div>
      ))}
    </div>
  );
}
