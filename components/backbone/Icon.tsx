import React from 'react';
import paths from './icon-paths';

export type IconName =
  | 'search' | 'home' | 'settings' | 'help' | 'info' | 'done' | 'cancel' | 'build'
  | 'compare' | 'calendar' | 'layers' | 'mail' | 'chat' | 'forum' | 'copy'
  | 'add-circle' | 'add-photo' | 'arrow-left' | 'arrow-right' | 'arrow-up'
  | 'chevron-right' | 'expand-more' | 'caret-down' | 'caret-up' | 'first-page'
  | 'last-page' | 'menu' | 'more' | 'sort' | 'subdir';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Glyph name from the 30-icon Backbone set. */
  name: IconName;
  /** Rendered px size. 14 inline with body text, 15–16 in controls, 18 in empty states. */
  size?: number | string;
}

export function Icon({ name, size = 16, style, ...rest }: IconProps) {
  const g = paths[name];
  if (!g) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={g.viewBox}
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: '0 0 auto', ...style }}
      dangerouslySetInnerHTML={{ __html: g.body }}
      {...rest}
    />
  );
}

export const iconNames = Object.keys(paths) as IconName[];
