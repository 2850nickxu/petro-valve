"use client";

import React from 'react';

/**
 * Canvas cannot inherit CSS, so the ink is read from computed style and the
 * chart redraws when the theme attributes on <html> change. No hex literals.
 */
export interface SparklineProps {
  points: number[];
  height?: number;
  /** Bar chart instead of an area line. */
  bars?: boolean;
  /** A semantic ink. Status only — do not use tone to separate two ordinary series. */
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'accent';
  /** A categorical ink, 1-6, from --cat-*. Use when a chart needs separation. */
  series?: 1 | 2 | 3 | 4 | 5 | 6;
  highlightLast?: boolean;
  /** Dashed comparison series — previous period. */
  baseline?: number[];
  /** Accessible description. Without it the chart is aria-hidden, which is correct for a decorative sparkline beside its own number. */
  label?: string;
  style?: React.CSSProperties;
}

/* Canvas cannot inherit CSS, so the ink is read off the element's own computed
   style and the chart redraws when the theme attributes on <html> change. No
   hex literals: a theme or neutral-temperature switch moves the chart with the
   rest of the interface.

   `tone` picks a semantic ink (status), `series` picks a categorical one
   (--cat-1…6). They are different channels — do not use status colour to
   distinguish two ordinary series. */
const TONE_VAR = {
  default: '--series-1',
  danger: '--danger-500',
  warning: '--warning-500',
  success: '--success-500',
  accent: '--accent-solid'
};

function rgba(color: string, alpha: number) {
  const m = String(color).trim();
  if (m.charAt(0) === '#') {
    const hex = m.length === 4
      ? m.slice(1).split('').map(c => c + c).join('')
      : m.slice(1);
    const n = parseInt(hex, 16);
    return 'rgba(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',') + ',' + alpha + ')';
  }
  const p = m.match(/[\d.]+/g);
  if (p && p.length >= 3) return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + alpha + ')';
  return m;
}

export function Sparkline({
  points = [], height = 34, bars = false, tone = 'default', series,
  highlightLast = true, baseline, label, style
}: SparklineProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const wrap = React.useRef<HTMLDivElement>(null);
  const [themeTick, setThemeTick] = React.useState<number>(0);

  React.useEffect(() => {
    const root = document.documentElement;
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => setThemeTick(t => t + 1));
    mo.observe(root, { attributes: true, attributeFilter: ['data-accent', 'data-neutral', 'class', 'style'] });
    return () => mo.disconnect();
  }, []);

  React.useEffect(() => {
    const cv = ref.current, box = wrap.current;
    if (!cv || !box) return;
    const draw = () => {
      const cs = getComputedStyle(box);
      const v = (name: string) => cs.getPropertyValue(name).trim();
      const ink = series ? v('--cat-' + series) : v(TONE_VAR[tone] || TONE_VAR.default);
      const dim = v('--series-2');
      const faint = v('--series-3');

      const w = box.clientWidth, h = height;
      const dpr = window.devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const all = baseline ? points.concat(baseline) : points;
      const max = Math.max.apply(null, all.concat([1]));
      const min = Math.min.apply(null, all.concat([0]));
      const span = (max - min) || 1;
      const y = (val: number) => h - ((val - min) / span) * (h - 2) - 1;

      if (bars) {
        const gap = 2, n = points.length;
        const bw = Math.max(1, (w - gap * (n - 1)) / n);
        points.forEach((val, i) => {
          const bh = Math.max(1, ((val - min) / span) * h);
          const last = i === n - 1, prev = i === n - 2;
          ctx.fillStyle = highlightLast && last ? ink : (highlightLast && prev ? dim : faint);
          ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
        });
        return;
      }

      const x = (i: number) => (i / Math.max(1, points.length - 1)) * w;
      if (baseline) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = dim;
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        baseline.forEach((val, i) => i ? ctx.lineTo(x(i), y(val)) : ctx.moveTo(x(i), y(val)));
        ctx.stroke();
        ctx.restore();
      }
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(ink, 0.18));
      grad.addColorStop(1, rgba(ink, 0));
      ctx.beginPath();
      points.forEach((val, i) => i ? ctx.lineTo(x(i), y(val)) : ctx.moveTo(x(i), y(val)));
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      points.forEach((val, i) => i ? ctx.lineTo(x(i), y(val)) : ctx.moveTo(x(i), y(val)));
      ctx.strokeStyle = ink; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.stroke();
    };
    draw();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    if (ro) ro.observe(box);
    return () => {
      if (ro) ro.disconnect();
    };
  }, [points, height, bars, tone, series, highlightLast, baseline, themeTick]);

  return (
    <div
      ref={wrap} role="img" aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}
      style={{ position: 'relative', height, width: '100%', ...style }}
    >
      <canvas ref={ref} style={{ display: 'block' }} />
    </div>
  );
}
