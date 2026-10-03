import * as React from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/** Decorative beside busy button text; supply a label when used alone. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return <span role={label ? 'status' : undefined} className="inline-flex">
    <LoaderCircle className={cn('h-4 w-4 animate-spin', className)} aria-hidden />
    {label && <span className="sr-only">{label}</span>}
  </span>;
}

/** Page loading uses content-shaped placeholders rather than an oversized icon. */
export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" aria-label={label} className="space-y-4 py-8">
    <Skeleton className="h-8 w-48 max-w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-32 w-full" />
  </div>;
}
