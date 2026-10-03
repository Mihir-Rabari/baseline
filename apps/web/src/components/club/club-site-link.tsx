'use client';
import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { slugify } from '@/lib/club-site';
import { Button, buttonVariants } from '@/components/ui/button';

/** Public website address for the club, shown to the owner so it can be opened and shared. */
export function ClubSiteLink() {
  const club = useQuery({ queryKey: ['public', 'club'], queryFn: () => api.public.club() });
  if (!club.data) return null;
  const path = `/site/${slugify(club.data.name)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); toast.success('Link copied'); } catch { toast.error('Copy failed. Select the link and copy it manually.'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Club website</span>
      <Link href={path} target="_blank" className="font-medium underline-offset-4 hover:underline">{path}</Link>
      <Link href={path} target="_blank" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Open</Link>
      <Button variant="outline" size="sm" onClick={copy}>Copy link</Button>
    </div>
  );
}
