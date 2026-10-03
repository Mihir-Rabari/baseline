import React from 'react';

export interface ChartPoint { label: string; value: number }

/**
 * A small area chart in plain SVG. The line draws itself on load; every point carries a title so
 * the value is available on hover and to assistive technology.
 */
export function AreaChart({ points, format, height = 160, ariaLabel }: {
  points: ChartPoint[]; format: (value: number) => string; height?: number; ariaLabel: string;
}) {
  const width = 600;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z`;
  const step = Math.ceil(points.length / 6);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="h-auto w-full overflow-visible">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={pad.left} x2={width - pad.right} y1={pad.top + innerH * f} y2={pad.top + innerH * f} className="stroke-border" strokeDasharray="3 4" />)}
      <path d={area} className="animate-fade-in fill-primary/10" />
      <path d={line} pathLength={1} className="animate-draw-line fill-none stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 1 }} />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.value)} r={4} className="animate-pop-in fill-background stroke-primary" strokeWidth={2}><title>{`${p.label}: ${format(p.value)}`}</title></circle>
          {i % step === 0 && <text x={x(i)} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">{p.label}</text>}
        </g>
      ))}
    </svg>
  );
}
