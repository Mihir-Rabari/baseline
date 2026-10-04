import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CountUp } from '@/components/club/count-up';

/**
 * A KPI card: label, the figure, and an optional trend or hint underneath.
 * `trend` colours the hint (success / destructive) and adds a direction arrow, so the
 * signal never rests on colour alone.
 */
export function StatTile({ label, value, hint, icon: Icon, trend }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; trend?: 'up' | 'down' | 'flat' }) {
  return (
    <div className="flex flex-col justify-between gap-1.5 overflow-hidden rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden /></span>}
      </div>
      <p className="tabular text-2xl font-semibold tracking-tight">{typeof value === 'number' ? <CountUp value={value} /> : value}</p>
      {hint && (
        <p className={cn('flex items-center gap-1 text-xs', trend === 'up' && 'text-success', trend === 'down' && 'text-destructive', (!trend || trend === 'flat') && 'text-muted-foreground')}>
          {trend === 'up' && <ArrowUpRight className="size-3.5" aria-hidden />}
          {trend === 'down' && <ArrowDownRight className="size-3.5" aria-hidden />}
          <span>{hint}</span>
        </p>
      )}
    </div>
  );
}
