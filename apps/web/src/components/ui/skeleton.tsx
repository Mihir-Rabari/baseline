import { cn } from '@/lib/utils';

/** A placeholder block with a soft light sweep, shaped like the content that is coming. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-muted before:absolute before:inset-y-0 before:left-0 before:w-1/3 before:-translate-x-full before:animate-shimmer before:bg-foreground/[0.05] before:blur-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
