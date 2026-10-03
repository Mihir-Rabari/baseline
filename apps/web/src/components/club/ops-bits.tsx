'use client';

import React from 'react';
import type { PaginatedResponseMeta } from '@packages/validation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageError } from '@/components/club/page-error';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Money } from '@/components/club/money';
import { cn } from '@/lib/utils';

/** Previous / Next controls for a paginated list. */
export function Pager({ meta, onPage }: { meta?: PaginatedResponseMeta; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
      <span>Page {meta.page} of {meta.totalPages} · {meta.totalItems} items</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!meta.hasPrevPage} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={!meta.hasNextPage} onClick={() => onPage(meta.page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** The loading, error and empty states every data screen owes the user, then the content. */
export function QueryState({ query, empty, children }: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown; isEmpty?: boolean };
  empty?: { title: string; description?: string };
  children: React.ReactNode;
}) {
  if (query.error) return <PageError error={query.error} onRetry={() => { void query.refetch(); }} />;
  if (query.isPending) return <div role="status" aria-label="Loading" className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (query.isEmpty && empty) return <EmptyState title={empty.title} description={empty.description} />;
  return <>{children}</>;
}

/** A number with a caption, for dashboards. */
export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Horizontal bars for a short list of amounts (revenue by source, by payment method, top items). */
export function BarList({ rows, money = true }: { rows: Array<{ label: string; value: number }>; money?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="space-y-1">
          <div className="flex justify-between text-sm"><span>{row.label}</span><span className="tabular">{money ? <Money paise={row.value} /> : row.value}</span></div>
          <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** Radix cannot hold an empty-string value, so "no value" options travel as this token. */
const EMPTY = '__none__';

/**
 * A labelled dropdown for a short list of options: keyboard and type-ahead friendly, animated, and
 * readable on a phone. `value` may be an empty string for a "no filter" option.
 */
export function SelectBox({ id, label, value, onChange, options, className, disabled, placeholder = 'Choose…' }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>; className?: string; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Select value={value === '' ? EMPTY : value} onValueChange={(next) => onChange(next === EMPTY ? '' : next)} disabled={disabled}>
        <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value || EMPTY} value={option.value === '' ? EMPTY : option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return <EmptyState title="You do not have access" description={`Your role cannot open ${what}. Sign in with an account that can, or ask the owner.`} />;
}

/** `FRONT_DESK` to `Front desk`; the UPI acronym keeps its capitals. */
export const humanize = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).replace(/\bupi\b/i, 'UPI');
