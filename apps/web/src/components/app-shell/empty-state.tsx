import React from 'react';

/**
 * What a list renders when it has nothing to show.
 *
 * Reach for this before rendering a grid of cards whose every field reads
 * "None listed" — a screen full of empty records looks broken, and it buries
 * the one thing the user should do next.
 *
 * `title` names the absence. `description` says why it is empty or what fills
 * it. `action` is the single next step, and is optional: some lists are empty
 * because nothing is wrong.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
