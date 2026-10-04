'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { routeIcon } from '@/components/app-shell/route-icons';

/**
 * The standard heading for a screen inside the app shell.
 *
 * Every app page opens with exactly one of these. It exists so screens stop
 * inventing their own header treatment — the reason the old pages each had a
 * different size, weight, and icon next to the title.
 *
 * `description` is one plain sentence explaining what the screen is for. If you
 * cannot write one, the screen probably does not need to exist.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Primary action for the screen, rendered top-right. At most two buttons. */
  actions?: React.ReactNode;
}) {
  const Icon = routeIcon(usePathname() ?? '');
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon && <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>}
        <div className="min-w-0 flex-1 space-y-1 break-words">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}
