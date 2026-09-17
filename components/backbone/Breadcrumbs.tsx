import React from 'react';
import { Icon } from './Icon';

export interface Crumb { label: string; href?: string }

export interface BreadcrumbsProps {
  /** Last item is the current page and renders as plain 900 text. */
  items: Crumb[];
  style?: React.CSSProperties;
}

export function Breadcrumbs({ items = [], style }: BreadcrumbsProps) {
  return (
    <nav style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', minWidth: 0, ...style
    }}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={it.label + i}>
            {last
              ? <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)', whiteSpace: 'nowrap' }}>{it.label}</span>
              : <a href={it.href || '#'} style={{ color: 'var(--text-tertiary)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{it.label}</a>}
            {last ? null : <Icon name="chevron-right" size={13} />}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
