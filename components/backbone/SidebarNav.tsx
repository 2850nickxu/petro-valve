"use client";
import React from 'react';
import { Icon } from './Icon';

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  /** A Badge, Counter or bare figure, right-aligned. */
  trailing?: React.ReactNode;
}

export interface SidebarNavProps {
  sections: Array<{ label?: string; items: NavItem[] }>;
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Accessible name for the nav landmark. */
  label?: string;
  style?: React.CSSProperties;
}

export function SidebarNav({ sections = [], activeId, onSelect, label = 'Primary', style }: SidebarNavProps) {
  return (
    <nav aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 'var(--space-3) 0', ...style }}>
      {sections.map((sec, si) => (
        <React.Fragment key={sec.label || si}>
          {sec.label ? (
            <div style={{
              padding: si === 0 ? '4px 16px 8px' : '18px 16px 8px',
              fontFamily: 'var(--font-ui)', fontSize: 'var(--text-label-size)',
              fontWeight: 'var(--text-label-weight)', letterSpacing: 'var(--text-label-tracking)',
              textTransform: 'uppercase', color: 'var(--text-muted)'
            }}>{sec.label}</div>
          ) : null}
          {(sec.items || []).map(item => <Item key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />)}
        </React.Fragment>
      ))}
    </nav>
  );
}

function Item({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect?: (id: string) => void }) {
  const [hover, setHover] = React.useState<boolean>(false);
  return (
    <a
      href={item.href || '#'}
      aria-current={active ? 'page' : undefined}
      onClick={e => { if (onSelect) { e.preventDefault(); onSelect(item.id); } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)',
        height: 'var(--nav-item-h)', padding: '0 16px',
        fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)', textDecoration: 'none',
        fontWeight: active ? 'var(--weight-medium)' : 'var(--weight-regular)',
        color: active ? 'var(--accent-on-surface)' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: active ? 'var(--accent-surface)' : (hover ? 'var(--surface-hover)' : 'transparent'),
        boxShadow: active ? 'var(--ring-active-nav)' : 'none'
      }}
    >
      {item.icon ? <Icon name={item.icon as React.ComponentProps<typeof Icon>['name']} size={16} /> : null}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      {item.trailing != null ? <span style={{ marginLeft: 'auto', display: 'flex', flex: '0 0 auto' }}>{item.trailing}</span> : null}
    </a>
  );
}
