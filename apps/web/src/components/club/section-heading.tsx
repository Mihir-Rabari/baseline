import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** A section title with an icon tile and a one-line subtitle. */
export function SectionHeading({ id, icon: Icon, title, subtitle, actions }: { id?: string; icon: LucideIcon; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden /></span>
        <div>
          <h2 id={id} className="text-base font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
