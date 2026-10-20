import React from 'react';

/**
 * Surface vocabulary. Three levels and only three — plus the page-level
 * container that sets the rhythm between them.
 *
 *   Section  ordinary page structure: heading, spacing, no border. The default.
 *            (A layout rule here, not a component — no screen needs one.)
 *   Panel    a bordered surface for a bounded thing (table, form, chart).
 *   Inset    a quiet filled block for supporting context inside either.
 *
 * If every group on a page is a Panel, none of them is.
 */
export interface PanelProps {
  title?: string;
  /** Caption-sized metadata sub-line under the title. */
  meta?: React.ReactNode;
  /** Right side of the header — legend, range label, or one ghost action. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Set false when the body is a table or a flush grid. */
  padded?: boolean;
  /**
   * Rule under the header. Defaults to `!padded` — a table-shaped body gets
   * one, a prose body does not. Pass explicitly to override.
   */
  divider?: boolean;
  /** Border tint for a panel that is itself in a failed or at-risk state. */
  tone?: 'default' | 'accent' | 'warning' | 'danger';
  /** Render as <section>/<article> when the panel is a document region. */
  as?: React.ElementType;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
}

export interface InsetProps {
  /** Uppercase 11px label above the content. */
  label?: string;
  children?: React.ReactNode;
  /** Only when it sits directly on a panel surface and would otherwise float. */
  bordered?: boolean;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger';
  style?: React.CSSProperties;
}

/** Page body: stacks Sections at --gap-section. Use instead of a bare div. */
export interface PageBodyProps {
  children?: React.ReactNode;
  /** var(--content-max) for docs, var(--content-max-form) for a settings form. */
  maxWidth?: number | string;
  style?: React.CSSProperties;
}

/* Surface vocabulary — three levels, and only three.

   Section  ordinary page structure. A heading, optional description, and
            spacing. No border, no fill. This is the default: most content
            groups on a page are Sections.
   Panel    a bordered surface for a bounded thing — a table, a form, a chart,
            a grouped interaction. Use it when the boundary explains the group.
   Inset    a quiet filled block for supporting context inside a Section or
            Panel — a summary, a definition, a read-only detail pair.

   If every group on a page is a Panel, none of them is. */

/* A Panel's header takes a divider when the body is a data region whose own
   rules would otherwise run into the header — a table, a list of rows, a log.
   A panel whose body is prose or a single control does not need one, and looks
   quieter without it. `divider` defaults to that rule: on when unpadded
   (table-shaped), off when padded. Pass it explicitly to override. */
export function Panel({
  title, meta, actions, children, padded = true, divider, tone = 'default',
  as = 'div', style, bodyStyle, headerStyle
}: PanelProps) {
  const Tag = as;
  const hasHeader = title || meta || actions;
  const showDivider = divider == null ? !padded : divider;
  const toned = tone === 'danger' ? { borderColor: 'var(--danger-line)' }
    : tone === 'warning' ? { borderColor: 'var(--warning-line)' }
    : tone === 'accent' ? { borderColor: 'var(--accent-line)' } : null;
  return (
    <Tag style={{
      background: 'var(--surface-panel)', border: 'var(--border-w) solid var(--border-default)',
      borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', minWidth: 0,
      ...toned, ...style
    }}>
      {hasHeader ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--gap-within)',
          padding: 'calc(var(--panel-pad) * 0.7) var(--panel-pad)',
          borderBottom: showDivider ? 'var(--border-w) solid var(--border-subtle)' : 'none',
          flexWrap: 'wrap', ...headerStyle
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            {title ? (
              <span style={{
                fontFamily: 'var(--font-ui)', fontSize: 'var(--text-section-size)',
                lineHeight: 'var(--text-section-line)', fontWeight: 'var(--text-section-weight)',
                letterSpacing: 'var(--text-section-tracking)', color: 'var(--text-primary)'
              }}>{title}</span>
            ) : null}
            {meta ? (
              <span style={{
                fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
                lineHeight: 'var(--text-caption-line)', color: 'var(--text-metadata)'
              }}>{meta}</span>
            ) : null}
          </div>
          {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)' }}>{actions}</div> : null}
        </div>
      ) : null}
      <div style={{
        padding: padded ? 'var(--panel-pad)' : 0, display: 'flex', flexDirection: 'column',
        gap: padded ? 'var(--gap-within)' : 0, minWidth: 0, ...bodyStyle
      }}>{children}</div>
    </Tag>
  );
}

/* Supporting context. Filled, unbordered by default — the fill is the whole
   signal. `bordered` only when it sits directly on the panel surface and would
   otherwise float. */
export function Inset({ label, children, bordered = false, tone = 'neutral', style }: InsetProps) {
  const tones = {
    neutral: { background: 'var(--surface-inset)', line: 'var(--border-default)', ink: 'var(--text-secondary)' },
    accent: { background: 'var(--accent-surface)', line: 'var(--accent-line)', ink: 'var(--accent-on-surface)' },
    danger: { background: 'var(--danger-tint)', line: 'var(--danger-line)', ink: 'var(--danger-deep)' },
    warning: { background: 'var(--warning-tint)', line: 'var(--warning-line)', ink: 'var(--warning-deep)' }
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{
      background: t.background, borderRadius: 'var(--radius-md)',
      border: bordered ? 'var(--border-w) solid ' + t.line : 'none',
      padding: 'calc(var(--panel-pad) * 0.7) var(--panel-pad)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', minWidth: 0,
      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
      lineHeight: 'var(--text-caption-line)', color: t.ink, ...style
    }}>
      {label ? (
        <span style={{
          fontSize: 'var(--text-label-size)', lineHeight: 'var(--text-label-line)',
          fontWeight: 'var(--text-label-weight)', letterSpacing: 'var(--text-label-tracking)',
          textTransform: 'uppercase', color: 'var(--text-muted)'
        }}>{label}</span>
      ) : null}
      {children}
    </div>
  );
}

/* The page body itself: sections separated by --gap-section, capped width
   optional. Use this rather than a bare div with a hand-picked gap. */
export function PageBody({ children, maxWidth, style }: PageBodyProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)',
      minWidth: 0, maxWidth: maxWidth || undefined, ...style
    }}>{children}</div>
  );
}
