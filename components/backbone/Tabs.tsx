"use client";
import React from 'react';
import { Counter } from './Counter';

/**
 * Two kinds of tab, with different semantics, because they make different
 * promises. `tabs` swaps a panel in place; `nav` changes the route.
 */
export interface TabItem {
  value: string;
  label: string;
  /** Count pill after the label. */
  count?: number;
  /** mode="nav" only. */
  href?: string;
  id?: string;
  panelId?: string;
}

export interface TabsProps {
  tabs: Array<TabItem | string>;
  value?: string;
  onChange?: (value: string) => void;
  /**
   * `tabs` (default): role=tablist, arrow-key navigation, one tab stop,
   * aria-controls wired to a TabPanel.
   * `nav`: a <nav> of links with aria-current. Use for route changes — tab
   * roles promise a panel that never arrives.
   */
  mode?: 'tabs' | 'nav';
  /** Namespace for generated ids. Must match the TabPanel's. */
  idPrefix?: string;
  /** Accessible name for the tablist or nav. */
  label?: string;
  style?: React.CSSProperties;
}

/** The other half of the contract. Renders nothing unless it is the active tab. */
export interface TabPanelProps {
  value: string;
  activeValue: string;
  idPrefix?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/* Two kinds of tab, with different semantics.

   `mode="tabs"` (default) — in-page tabs that swap a panel. Real tab roles,
   arrow-key navigation, one tab stop, aria-controls wiring. Give each tab an
   `id` matching the panel's `aria-labelledby`, or let it derive one.

   `mode="nav"` — a row of links that changes the route. These are not tabs:
   they are navigation, so they render as <a> in a <nav> with aria-current.
   Using tab roles for navigation makes screen readers promise a panel that
   never arrives. */
export function Tabs({
  tabs = [], value, onChange, mode = 'tabs', idPrefix = 'bb-tab',
  label = 'Sections', style
}: TabsProps) {
  const items: TabItem[] = tabs.map(t => (typeof t === 'string' ? { value: t, label: t } : t));
  const current = value != null ? value : (items[0] && items[0].value);
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (e: React.KeyboardEvent, i: number) => {
    const keys: Record<string, number | 'first' | 'last'> = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    const k = keys[e.key];
    if (k == null) return;
    e.preventDefault();
    const next = k === 'first' ? 0 : k === 'last' ? items.length - 1
      : (i + k + items.length) % items.length;
    const t = items[next];
    if (!t) return;
    if (onChange) onChange(t.value);
    const el = refs.current[t.value];
    if (el) el.focus();
  };

  const row: React.CSSProperties = {
    display: 'flex', gap: 2, padding: '0 var(--page-pad)',
    borderBottom: 'var(--border-w) solid var(--border-default)', ...style
  };

  const itemStyle = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 'calc(var(--control-h-default) + 4px)', padding: '0 12px',
    background: 'transparent', border: 'none', marginBottom: -1,
    borderBottom: '2px solid ' + (on ? 'var(--accent-bar)' : 'transparent'),
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)',
    fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)',
    color: on ? 'var(--text-primary)' : 'var(--text-muted)',
    textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap'
  });

  if (mode === 'nav') {
    return (
      <nav aria-label={label} style={row}>
        {items.map(t => {
          const on = t.value === current;
          return (
            <a
              key={t.value} href={t.href || '#'} aria-current={on ? 'page' : undefined}
              onClick={e => { if (onChange) { e.preventDefault(); onChange(t.value); } }}
              style={itemStyle(on)}
            >
              {t.label}
              {t.count != null ? <Counter value={t.count} /> : null}
            </a>
          );
        })}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} style={row}>
      {items.map((t, i) => {
        const on = t.value === current;
        return (
          <button
            key={t.value} type="button" role="tab" id={t.id || idPrefix + '-' + t.value}
            aria-selected={on} aria-controls={t.panelId || idPrefix + '-panel-' + t.value}
            tabIndex={on ? 0 : -1}
            ref={el => { refs.current[t.value] = el; }}
            onKeyDown={e => move(e, i)}
            onClick={() => onChange && onChange(t.value)}
            style={itemStyle(on)}
          >
            {t.label}
            {t.count != null ? <Counter value={t.count} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* The other half of the contract. Wrap the content a tab swaps in. */
export function TabPanel({ value, activeValue, idPrefix = 'bb-tab', children, style }: TabPanelProps) {
  if (value !== activeValue) return null;
  return (
    <div
      role="tabpanel" id={idPrefix + '-panel-' + value}
      aria-labelledby={idPrefix + '-' + value} tabIndex={0}
      style={{ minWidth: 0, ...style }}
    >{children}</div>
  );
}
