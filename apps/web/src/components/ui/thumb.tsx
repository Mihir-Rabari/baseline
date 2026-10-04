import React from 'react';
import { mediaUrl } from '@/lib/upload-api';
import { cn } from '@/lib/utils';

/** A small photo for a product, court, menu item or person. Falls back to the first letter when there is none. */
export function Thumb({ src, name, className, round }: { src?: string | null; name: string; className?: string; round?: boolean }) {
  const url = mediaUrl(src);
  const shape = cn('shrink-0 object-cover', round ? 'rounded-full' : 'rounded-lg', className ?? 'size-10');
  return url
    ? <img src={url} alt="" loading="lazy" className={shape} />
    : <span aria-hidden className={cn(shape, 'flex items-center justify-center bg-primary/10 text-sm font-semibold text-primary')}>{name.charAt(0).toUpperCase()}</span>;
}
