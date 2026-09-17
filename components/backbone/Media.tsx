"use client";

import React from 'react';

/**
 * Imagery, for when the image is the content — a product photo, a document
 * preview, a map tile. The frame owns the aspect ratio and crops to fill;
 * a neutral ground shows through while loading or on failure.
 *
 * There is still no decorative imagery and no illustration in Backbone.
 */
export interface MediaProps {
  src?: string;
  /** Required whenever the image carries information. "" for pure duplication of adjacent text. */
  alt?: string;
  /** Named ratio or any CSS aspect-ratio string. Ignored when `height` is set. */
  ratio?: 'square' | 'wide' | 'photo' | 'portrait' | 'tall' | string;
  width?: number | string;
  height?: number | string;
  /** Follows the surface: md in a panel, none in a table row, full for a person. */
  radius?: 'none' | 'sm' | 'md' | 'full';
  /** Word or initials shown on the ground when there is no image. Not an icon. */
  fallback?: React.ReactNode;
  /** Caption ink below the frame. */
  caption?: React.ReactNode;
  /** A Badge pinned bottom-left — "Primary", "3 pages", a duration. */
  badge?: React.ReactNode;
  loading?: 'lazy' | 'eager';
  style?: React.CSSProperties;
}

/** Lead image plus a thumbnail row. The record-detail pattern. */
export interface MediaStripProps {
  items: Array<{ src?: string; alt?: string; fallback?: React.ReactNode }>;
  index?: number;
  onIndex?: (index: number) => void;
  alt?: string;
  label?: string;
  style?: React.CSSProperties;
}

/* Imagery is permitted when the image *is* the content — a product photo, a
   document preview, a map tile, a person. It is never decoration, and there is
   still no illustration in the system.

   Rules the component enforces so screens do not each reinvent them:
   - The frame owns the aspect ratio; the image is cropped to fill it
     (object-fit: cover). Photos are never letterboxed.
   - A neutral ground sits under every image, so a slow or broken source is a
     surface rather than a hole.
   - Fallback is a caption-sized word or initials on that ground — not an icon
     standing in for a missing picture.
   - Radius follows the surface it sits on: 6 in a panel, 0 inside a table row
     (pass radius="none"), full only for a person. */
const RATIOS: Record<string, string> = { square: '1 / 1', wide: '16 / 9', photo: '4 / 3', portrait: '3 / 4', tall: '2 / 3' };

export function Media({
  src, alt = '', ratio = 'square', width, height, radius = 'md', fallback,
  caption, badge, loading = 'lazy', style
}: MediaProps) {
  const [failed, setFailed] = React.useState<boolean>(false);
  const r = radius === 'none' ? 0 : radius === 'full' ? 'var(--radius-full)'
    : radius === 'sm' ? 'var(--radius-sm)' : 'var(--radius-md)';
  const frame: React.CSSProperties = {
    position: 'relative', display: 'block', overflow: 'hidden', flex: '0 0 auto',
    width: width || '100%', height: height || undefined,
    aspectRatio: height ? undefined : (RATIOS[ratio] || ratio),
    background: 'var(--surface-media)', borderRadius: r, minWidth: 0, ...style
  };
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', minWidth: 0, width: width || '100%' }}>
      <span style={frame}>
        {src && !failed ? (
          <img
            src={src} alt={alt} loading={loading} onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-2)', textAlign: 'center',
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
            lineHeight: 'var(--text-caption-line)', color: 'var(--text-muted)'
          }}>{fallback || (alt ? alt : 'No image')}</span>
        )}
        {badge ? (
          <span style={{ position: 'absolute', left: 'var(--space-2)', bottom: 'var(--space-2)', display: 'flex' }}>{badge}</span>
        ) : null}
      </span>
      {caption ? (
        <figcaption style={{
          fontFamily: 'var(--font-ui)', fontSize: 'var(--text-caption-size)',
          lineHeight: 'var(--text-caption-line)', color: 'var(--text-metadata)'
        }}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/* A strip of previews — the record-detail pattern: one lead image and a row of
   thumbnails under it. Selection is real navigation, so the thumbs are
   buttons with aria-pressed. */
export function MediaStrip({ items = [], index = 0, onIndex, alt = '', label = 'Images', style }: MediaStripProps) {
  const current = items[index] || items[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0, ...style }}>
      <Media src={current && current.src} alt={(current && current.alt) || alt} ratio="photo" fallback={current && current.fallback} />
      {items.length > 1 ? (
        <div role="group" aria-label={label} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {items.map((it, i) => (
            <button
              key={i} type="button" aria-pressed={i === index} aria-label={it.alt || 'Image ' + (i + 1)}
              onClick={() => onIndex && onIndex(i)}
              style={{
                width: 56, height: 44, padding: 0, overflow: 'hidden', cursor: 'pointer',
                background: 'var(--surface-media)', borderRadius: 'var(--radius-sm)',
                border: 'var(--border-w) solid ' + (i === index ? 'var(--accent-solid)' : 'var(--border-default)'),
                boxShadow: i === index ? 'inset 0 0 0 1px var(--accent-solid)' : 'none'
              }}
            >
              {it.src ? <img src={it.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
