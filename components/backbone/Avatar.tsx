"use client";
import React from 'react';

/** Initials by default; a photo when the product has one. Round for a person, square for an entity. */
export interface AvatarProps {
  initials?: string;
  /** Falls back to initials on error. */
  src?: string;
  alt?: string;
  /** Becomes the title attribute. */
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  /** A neutral-ramp fill. Never a signal hue. */
  tint?: string;
  style?: React.CSSProperties;
}

const SIZES = { xs: { box: 20, font: 9 }, sm: { box: 24, font: 10 }, md: { box: 32, font: 12 }, lg: { box: 40, font: 14 } };

/* Initials by default; a photo when the product has one. A person's avatar is
   round, a workspace or entity avatar is square — that difference is the only
   thing shape carries. */
export function Avatar({ initials, src, alt, name, size = 'md', shape = 'square', tint, style }: AvatarProps) {
  const [failed, setFailed] = React.useState<boolean>(false);
  const s = SIZES[size] || SIZES.md;
  const showImage = src && !failed;
  const filled = !!tint || shape === 'circle';
  return (
    <span
      title={name || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
        width: s.box, height: s.box, overflow: 'hidden',
        borderRadius: shape === 'circle' ? 'var(--radius-full)' : 'var(--radius-md)',
        background: showImage ? 'var(--surface-media)' : (tint || (shape === 'circle' ? 'var(--gray-900)' : 'var(--surface-sunken)')),
        border: showImage || filled ? 'none' : 'var(--border-w) solid var(--border-default)',
        color: filled ? 'var(--text-inverse)' : 'var(--text-tertiary)',
        fontFamily: 'var(--font-ui)', fontSize: s.font, fontWeight: 'var(--weight-semibold)', ...style
      }}
    >
      {showImage ? (
        <img
          src={src} alt={alt != null ? alt : ''} onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : initials}
    </span>
  );
}
