"use client";
import React from 'react';
import { Icon, type IconName } from './Icon';

/* Box size follows the density control heights, so an icon button lines up
   with the text button beside it in either density. */
const SIZES = {
  micro: { box: 'var(--control-h-micro)', icon: 14 },
  default: { box: 'var(--control-h-default)', icon: 15 },
  large: { box: 'var(--control-h-large)', icon: 16 }
};

/** Box size follows the density control heights, so it lines up with a Button beside it. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  /** Required — becomes aria-label and title. */
  label: string;
  variant?: 'secondary' | 'ghost';
  size?: 'micro' | 'default' | 'large';
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function IconButton({ icon, label, variant = 'secondary', size = 'default', disabled = false, onClick, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = React.useState(false);
  const s = SIZES[size] || SIZES.default;
  const outlined = variant === 'secondary';
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
        width: s.box, height: s.box, borderRadius: 'var(--radius-md)',
        borderStyle: 'solid', borderWidth: 'var(--border-w)',
        borderColor: outlined ? (hover ? 'var(--border-hover)' : 'var(--control-secondary-border)') : 'transparent',
        background: outlined ? 'var(--control-secondary-bg)' : (hover ? 'var(--control-ghost-bg-hover)' : 'transparent'),
        color: disabled ? 'var(--text-disabled)' : (hover ? 'var(--text-primary)' : 'var(--text-secondary)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background var(--dur-instant), border-color var(--dur-instant)',
        ...style
      }}
      {...rest}
    >
      <Icon name={icon as IconName} size={s.icon} />
    </button>
  );
}
