'use client';
import React from 'react';
import type { SharedDashboardReport } from '@packages/validation';
import { formatMoney } from '@/lib/format';
export function RevenueBars({ title, rows }: { title: string; rows: { label: string; amountPaise: number }[] }) {
  const max = Math.max(1, ...rows.map(row => Math.abs(row.amountPaise)));
  return <section className="space-y-4"><h2 className="text-lg font-semibold">{title}</h2><ul className="space-y-4">{rows.map(row => <li key={row.label} className="space-y-1"><div className="flex justify-between gap-4 text-sm"><span>{row.label}{row.amountPaise < 0 ? ' (net refunds)' : ''}</span><span className="tabular">{formatMoney(row.amountPaise)}</span></div><div className="h-3 bg-muted" aria-hidden><div className={row.amountPaise < 0 ? 'h-full bg-chart-3' : 'h-full bg-chart-1'} style={{ width: `${Math.abs(row.amountPaise) / max * 100}%` }} /></div></li>)}</ul></section>;
}
export function ReportCharts({ report }: { report: SharedDashboardReport }) {
  const min = Math.min(0, ...report.trend.map(point => point.totalPaise));
  const max = Math.max(1, ...report.trend.map(point => point.totalPaise));
  const coordinates = report.trend.map((point, i) => ({ ...point, x: 20 + i / Math.max(1, report.trend.length - 1) * 560, y: 180 - (point.totalPaise - min) / (max - min) * 160 }));
  return <div className="space-y-8"><div className="grid gap-8 md:grid-cols-2"><RevenueBars title="Revenue by source" rows={report.bySource.map(row => ({ label: row.source.toLowerCase(), amountPaise: row.amountPaise }))} /><RevenueBars title="Revenue by payment mode" rows={report.byMethod.map(row => ({ label: row.method, amountPaise: row.amountPaise }))} /></div><section className="space-y-4"><h2 className="text-lg font-semibold">Revenue trend</h2><div className="flex justify-between text-sm text-muted-foreground"><span>Low: {formatMoney(min)}</span><span>High: {formatMoney(max)}</span></div><svg role="img" aria-label="Revenue trend over the selected period" viewBox="0 0 600 200" className="w-full text-chart-1"><polyline fill="none" stroke="currentColor" strokeWidth="3" points={coordinates.map(point => `${point.x},${point.y}`).join(' ')} />{coordinates.map(point => <circle key={point.bucket} cx={point.x} cy={point.y} r="4" fill="currentColor"><title>{point.bucket}: {formatMoney(point.totalPaise)}</title></circle>)}</svg><details><summary className="cursor-pointer text-sm">View daily revenue</summary><dl className="divide-y text-sm">{report.trend.map(point => <div className="flex justify-between py-2" key={point.bucket}><dt>{point.bucket}</dt><dd className="tabular">{formatMoney(point.totalPaise)}</dd></div>)}</dl></details></section></div>;
}
