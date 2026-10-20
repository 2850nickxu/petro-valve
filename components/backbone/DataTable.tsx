"use client";

import React from 'react';
import { Icon } from './Icon';

export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Mono figures — identifiers, hashes, code. Not ordinary quantities. */
  mono?: boolean;
  /** UI-font tabular figures. This is the default treatment for counts and money. */
  numeric?: boolean;
  /** Primary ink and medium weight — the column that identifies the row. One per table. */
  primary?: boolean;
  muted?: boolean;
  /** Allow the cell to wrap. Rows grow with their content. */
  wrap?: boolean;
  sortable?: boolean;
  width?: number | string;
  render?: (row: any) => React.ReactNode;
}

export interface DataTableProps {
  columns: Column[];
  rows: any[];
  /**
   * 'auto' (default) follows the surrounding data-density. Override per table,
   * or wrap the table in <div data-density="compact">. 'relaxed' is for cells
   * holding two lines or media.
   */
  density?: 'auto' | 'compact' | 'standard' | 'relaxed';
  /** Sortable heads carry aria-sort. */
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  /** Real checkboxes with indeterminate state; selected rows carry aria-selected. */
  selectable?: boolean;
  selected?: string[];
  onSelect?: (key: string) => void;
  onSelectAll?: (on: boolean) => void;
  rowKey?: string;
  minWidth?: number;
  /** Table caption — the accessible description of what the rows are. */
  caption?: string;
  /** Makes rows clickable. The row's own buttons stop propagation. */
  onRowClick?: (row: any) => void;
  /** Rendered in a full-width cell when rows is empty. Pass an EmptyState. */
  emptyState?: React.ReactNode;
  style?: React.CSSProperties;
}

/* Row height follows density by default: 40px in a standard region, 32px in a
   compact one. Pass `density` to override for one table — the common case is a
   compact table inside a standard page shell, which you can also do by wrapping
   the table in <div data-density="compact">. `relaxed` exists for tables whose
   cells hold two lines or media. */
const ROW_H = {
  compact: '32px',
  standard: '40px',
  relaxed: '56px',
  auto: 'var(--row-h)'
};

export function DataTable({
  columns = [], rows = [], density = 'auto', sort, onSort,
  selectable = false, selected = [], onSelect, onSelectAll,
  rowKey = 'id', minWidth = 920, caption, onRowClick, emptyState, style
}: DataTableProps) {
  const h = ROW_H[density] || ROW_H.auto;
  const allOn = selectable && rows.length > 0 && selected.length === rows.length;
  const someOn = selectable && selected.length > 0 && !allOn;
  const headCell: React.CSSProperties = {
    borderBottom: 'var(--border-w) solid var(--border-default)',
    height: 'var(--table-head-h)', verticalAlign: 'middle',
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-label-size)',
    fontWeight: 'var(--weight-semibold)', letterSpacing: '0.06em',
    textTransform: 'uppercase', color: 'var(--text-metadata)'
  };
  return (
    <div style={{ overflowX: 'auto', ...style }}>
      <table style={{ width: '100%', minWidth, borderCollapse: 'collapse' }}>
        {caption ? (
          <caption style={{
            captionSide: 'top', textAlign: 'left', padding: '0 var(--cell-pad-x) var(--space-2)',
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)', color: 'var(--text-metadata)'
          }}>{caption}</caption>
        ) : null}
        <thead>
          <tr style={{ background: 'var(--surface-sunken)' }}>
            {selectable ? (
              <th scope="col" style={{ ...headCell, width: 38, padding: '0 0 0 var(--cell-pad-x)' }}>
                <Box on={allOn} mixed={someOn} onChange={() => onSelectAll && onSelectAll(!allOn)} label="Select all rows" />
              </th>
            ) : null}
            {columns.map(c => {
              const numeric = c.align === 'right';
              const sortable = !!c.sortable && !!onSort;
              const active = sort && sort.key === c.key;
              const dir = active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : (sortable ? 'none' : undefined);
              const cell: React.CSSProperties = {
                ...headCell,
                textAlign: numeric ? 'right' : 'left',
                padding: sortable ? 0 : '0 var(--cell-pad-x)',
                width: c.width
              };
              if (!sortable) return <th key={c.key} scope="col" style={cell}>{c.label}</th>;
              return (
                <th key={c.key} scope="col" aria-sort={dir} style={cell}>
                  <button
                    type="button" onClick={() => onSort!(c.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, width: '100%',
                      height: 'var(--table-head-h)', padding: '0 var(--cell-pad-x)',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      justifyContent: numeric ? 'flex-end' : 'flex-start',
                      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-label-size)',
                      fontWeight: 'var(--weight-semibold)', letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: active ? 'var(--text-primary)' : 'var(--text-metadata)'
                    }}
                  >
                    {c.label}
                    <Icon name={active ? (sort?.dir === 'asc' ? 'caret-up' : 'caret-down') : 'sort'} size={13} aria-hidden="true" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ padding: 0 }}>{emptyState}</td>
            </tr>
          ) : rows.map(r => {
            const key = r[rowKey];
            return (
              <Row
                key={key} row={r} columns={columns} height={h} selectable={selectable}
                selected={selected.indexOf(key) > -1} onSelect={() => onSelect && onSelect(key)}
                onRowClick={onRowClick}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RowProps {
  row: any;
  columns: Column[];
  height: string;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onRowClick?: (row: any) => void;
}

function Row({ row, columns, height, selectable, selected, onSelect, onRowClick }: RowProps) {
  const [hover, setHover] = React.useState<boolean>(false);
  const clickable = !!onRowClick;
  const td: React.CSSProperties = {
    height, padding: '0 var(--cell-pad-x)',
    borderBottom: 'var(--border-w) solid var(--border-subtle)',
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-size)',
    color: 'var(--text-secondary)', whiteSpace: 'nowrap'
  };
  return (
    <tr
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={clickable ? () => onRowClick!(row) : undefined}
      aria-selected={selectable ? selected : undefined}
      style={{
        background: selected ? 'var(--surface-selected)' : (hover ? 'var(--surface-hover)' : 'var(--surface-panel)'),
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: selected ? 'inset 2px 0 0 var(--accent-bar)' : 'none'
      }}
    >
      {selectable ? (
        <td style={{ ...td, padding: '0 0 0 var(--cell-pad-x)' }} onClick={e => e.stopPropagation()}>
          <Box on={selected} onChange={onSelect} label="Select row" />
        </td>
      ) : null}
      {columns.map((c) => (
        <td key={c.key} style={{
          ...td,
          textAlign: c.align === 'right' ? 'right' : 'left',
          fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-ui)',
          fontVariantNumeric: c.mono || c.numeric ? 'var(--numeric-tabular)' : 'normal',
          fontWeight: c.primary ? 'var(--weight-medium)' : 'var(--weight-regular)',
          color: c.muted ? 'var(--text-metadata)' : c.primary ? 'var(--text-primary)' : 'var(--text-secondary)',
          whiteSpace: c.wrap ? 'normal' : 'nowrap'
        }}>
          {c.render ? c.render(row) : row[c.key]}
        </td>
      ))}
    </tr>
  );
}

interface BoxProps {
  on: boolean;
  mixed?: boolean;
  onChange?: () => void;
  label: string;
}

/* A real checkbox: checked, indeterminate and keyboard behaviour come from the
   native input. The visible 16px box is drawn on top of it. */
function Box({ on, mixed = false, onChange, label }: BoxProps) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return (
    <span style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 'var(--box-sm)', height: 'var(--box-sm)', flex: '0 0 auto'
    }}>
      <input
        ref={ref} type="checkbox" checked={on} aria-label={label} onChange={onChange}
        style={{
          position: 'absolute', inset: '-8px', width: 'calc(100% + 16px)', height: 'calc(100% + 16px)',
          margin: 0, opacity: 0, cursor: 'pointer'
        }}
      />
      <span aria-hidden="true" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%', borderRadius: 'var(--radius-lg)',
        border: 'var(--border-w) solid ' + (on || mixed ? 'var(--accent-solid)' : 'var(--control-secondary-border)'),
        background: on || mixed ? 'var(--accent-solid)' : 'var(--surface-panel)',
        color: 'var(--accent-on-solid)'
      }}>
        {mixed ? <span style={{ width: 8, height: 2, background: 'currentColor' }} />
          : on ? <Icon name="done" size={11} /> : null}
      </span>
    </span>
  );
}
