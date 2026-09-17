import React from 'react';
import { Avatar } from './Avatar';

export interface AvatarStackProps {
  /** Initials, in display order. */
  people: string[];
  /** How many to show before the +N chip. Default 3. */
  max?: number;
  style?: React.CSSProperties;
}

const TINTS = ['var(--gray-700)', 'var(--gray-500)', 'var(--gray-350)', 'var(--gray-600)'];

export function AvatarStack({ people = [], max = 3, style }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span style={{ display: 'flex', alignItems: 'center', ...style }}>
      {shown.map((p, i) => (
        <Avatar
          key={p + i} initials={p} size="sm" shape="circle" tint={TINTS[i % TINTS.length]}
          style={{ border: '1.5px solid var(--gray-000)', marginLeft: i === 0 ? 0 : -7 }}
        />
      ))}
      {rest > 0 ? (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, marginLeft: -7, borderRadius: 'var(--radius-full)',
          background: 'var(--surface-sunken)', border: '1.5px solid var(--gray-000)',
          boxShadow: '0 0 0 1px var(--border-default)',
          color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 'var(--weight-medium)'
        }}>+{rest}</span>
      ) : null}
    </span>
  );
}
