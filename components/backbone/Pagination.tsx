"use client";
import React from 'react';
import { IconButton } from './IconButton';

export interface PaginationProps {
  /** Mono range label, e.g. "41–60 of 428". */
  label?: string;
  page?: number;
  pages?: number;
  onPage?: (page: number) => void;
  /** Hide the numbered buttons when the total page count is unknown. */
  showPages?: boolean;
  style?: React.CSSProperties;
}

export function Pagination({ label, page = 1, pages = 1, onPage, showPages = true, style }: PaginationProps) {
  const nums: number[] = [];
  if (showPages) {
    const from = Math.max(1, Math.min(page - 1, pages - 2));
    for (let i = from; i < from + 3 && i <= pages; i++) nums.push(i);
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...style }}>
      {label ? (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums'
        }}>{label}</span>
      ) : null}
      <div style={{ display: 'flex', gap: 2 }}>
        <IconButton icon="first-page" label="First page" size="micro" style={{ width: 26, height: 26, borderColor: 'var(--border-default)' }} onClick={() => onPage && onPage(1)} />
        <IconButton icon="arrow-left" label="Previous page" size="micro" style={{ width: 26, height: 26, borderColor: 'var(--border-default)' }} onClick={() => onPage && onPage(Math.max(1, page - 1))} />
        {nums.map(n => (
          <button
            key={n} type="button" onClick={() => onPage && onPage(n)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 26, height: 26, padding: '0 6px', borderRadius: 'var(--radius-md)',
              border: 'var(--border-w) solid ' + (n === page ? 'var(--gray-900)' : 'var(--border-default)'),
              background: n === page ? 'var(--gray-900)' : 'var(--surface-panel)',
              color: n === page ? 'var(--text-inverse)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer'
            }}
          >{n}</button>
        ))}
        <IconButton icon="arrow-right" label="Next page" size="micro" style={{ width: 26, height: 26, borderColor: 'var(--border-default)' }} onClick={() => onPage && onPage(Math.min(pages, page + 1))} />
        <IconButton icon="last-page" label="Last page" size="micro" style={{ width: 26, height: 26, borderColor: 'var(--border-default)' }} onClick={() => onPage && onPage(pages)} />
      </div>
    </div>
  );
}
