"use client";
import React from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface CommandItem {
  label: string;
  icon?: IconName;
  /** Mono shortcut or state hint on the right, e.g. "G O" or "failed". */
  hint?: string;
  onSelect?: () => void;
}

export interface CommandGroup { group: string; items: CommandItem[] }

export interface CommandPaletteProps {
  open?: boolean;
  /** Grouped commands — Actions, then objects, then Go to. */
  groups: CommandGroup[];
  query?: string;
  onQuery?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose?: () => void;
  placeholder?: string;
}

export function CommandPalette({ open = true, groups = [], query = '', onQuery, onClose, placeholder = 'Search commands, pipelines, people…' }: CommandPaletteProps) {
  if (!open) return null;
  const q = query.trim().toLowerCase();
  const results = q
    ? groups.map(g => ({ group: g.group, items: g.items.filter(i => i.label.toLowerCase().includes(q)) })).filter(g => g.items.length)
    : groups;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110, background: 'var(--overlay-scrim)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '96px 24px 24px'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: 'var(--surface-panel)',
          border: 'var(--border-w) solid var(--border-default)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: 'var(--border-w) solid var(--border-default)' }}>
          <span style={{ display: 'flex', color: 'var(--text-muted)' }}><Icon name="search" size={16} /></span>
          <input
            autoFocus value={query} onChange={onQuery} placeholder={placeholder}
            style={{
              flex: '1 1 auto', height: 46, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-primary)'
            }}
          />
          <Key>ESC</Key>
        </div>
        <div style={{ maxHeight: 320, overflow: 'auto', padding: '6px 0' }}>
          {results.length ? results.map(g => (
            <div key={g.group} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{
                padding: '8px 14px 4px', fontFamily: 'var(--font-ui)', fontSize: 11,
                fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--text-label-tracking)',
                textTransform: 'uppercase', color: 'var(--text-muted)'
              }}>{g.group}</div>
              {g.items.map(it => <Row key={it.label} item={it} />)}
            </div>
          )) : (
            <div style={{ padding: '32px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 'var(--weight-medium)', color: 'var(--text-secondary)' }}>Nothing matches “{query}”</span>
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)' }}>Try a pipeline name or a command verb.</span>
            </div>
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px',
          borderTop: 'var(--border-w) solid var(--border-subtle)', background: 'var(--surface-page)',
          fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)'
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Key>↑↓</Key>navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Key>↵</Key>run</span>
        </div>
      </div>
    </div>
  );
}

function Row({ item }: { item: CommandItem }) {
  const [hover, setHover] = React.useState<boolean>(false);
  return (
    <button
      type="button" onClick={item.onSelect}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 34, padding: '0 14px',
        background: hover ? 'var(--control-ghost-bg-hover)' : 'transparent', border: 'none',
        textAlign: 'left', cursor: 'pointer', color: 'var(--text-secondary)'
      }}
    >
      {item.icon ? <span style={{ display: 'flex', color: 'var(--text-muted)' }}><Icon name={item.icon} size={15} /></span> : null}
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, flex: '1 1 auto' }}>{item.label}</span>
      {item.hint ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-disabled)' }}>{item.hint}</span> : null}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
      background: 'var(--surface-panel)', border: 'var(--border-w) solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: '1px 4px'
    }}>{children}</kbd>
  );
}
