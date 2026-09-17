import React from 'react';

/** Mirror the real layout: same row height, same column widths, ~6 rows max. */
export interface SkeletonProps {
  lines?: number;
  widths?: Array<string | number>;
  /** Bar height. Default 11px. */
  height?: number;
  /** Block height — for a media or card placeholder rather than text bars. */
  block?: number;
  style?: React.CSSProperties;
}

/* Mirror the real layout: same row height, same column widths, ~6 rows max.
   Bars are decorative — the surrounding region carries aria-busy. */
export function Skeleton({ lines = 3, widths = ['40%', '85%', '66%'], height = 11, block, style }: SkeletonProps) {
  const h = block != null ? block : height;
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{
          height: h, width: widths[i % widths.length], borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(90deg,var(--gray-050) 0px,var(--gray-100) 60px,var(--gray-050) 120px)',
          backgroundSize: '400px 100%',
          animation: 'bb-shimmer var(--dur-shimmer) linear infinite'
        }} />
      ))}
    </div>
  );
}
