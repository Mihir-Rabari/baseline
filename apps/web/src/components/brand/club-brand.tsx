'use client';
import React from 'react';
import { useClubSite } from '@/hooks/use-club-site';
import { mediaUrl } from '@/lib/upload-api';
import { BrandMark } from '@/components/brand/brand-mark';
import { cn } from '@/lib/utils';

/**
 * The club's own logo and name, as set in Club settings. The Baseline mark only stands in
 * while the club has no logo (or the lookup has not finished).
 */
export function ClubBrand({ size = 'md', subtitle, name, className }: { size?: 'sm' | 'md' | 'lg'; subtitle?: string | false; /** Overrides the club name, e.g. the product name on the public pitch. */ name?: string; className?: string }) {
  const { data } = useClubSite();
  const logo = mediaUrl(data?.branding.logoUrl);
  const box = size === 'lg' ? 'size-12 rounded-xl' : size === 'sm' ? 'size-6 rounded-md' : 'size-8 rounded-lg';
  const text = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-sm' : 'text-sm';
  const sub = subtitle === undefined ? (data ? 'Club workspace' : 'Court management') : subtitle;
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {logo ? <img src={logo} alt="" className={cn('shrink-0 object-cover', box)} /> : <BrandMark className={cn('rounded-none', box)} />}
      <span className="min-w-0 leading-tight">
        <span className={cn('block truncate font-semibold tracking-tight', text)}>{name ?? data?.name ?? 'Baseline'}</span>
        {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </span>
  );
}
