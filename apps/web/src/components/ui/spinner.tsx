import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A small rotating ring for work in progress. It is decorative next to text that already says what
 * is happening ("Saving…"); pass `label` when the spinner stands alone so it is announced.
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex">
      <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** A centred spinner with a caption, for a whole screen or panel that is loading. */
export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground animate-fade-in">
      <Spinner className="h-6 w-6" label={label} />
      <p className="text-sm" aria-hidden="true">{label}…</p>
    </div>
  );
}
