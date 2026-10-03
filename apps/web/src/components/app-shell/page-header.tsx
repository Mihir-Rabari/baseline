import React from 'react';

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
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
