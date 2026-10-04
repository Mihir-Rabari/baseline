import React from 'react';
import { cn } from '@/lib/utils';

/** The Baseline logo: a court seen from above with the ball on the baseline. Takes its colour from the theme. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="Baseline" className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g className="stroke-primary-foreground" fill="none" strokeWidth="1.6" strokeLinecap="round">
        <rect x="7" y="7" width="18" height="18" rx="1.5" />
        <path d="M7 22h18M16 7v15" />
      </g>
      <circle cx="21" cy="22" r="2.4" className="fill-primary-foreground" />
    </svg>
  );
}
