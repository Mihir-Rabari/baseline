'use client';
import React from 'react';
import Link from 'next/link';
import { usePublicAvailability } from '@/hooks/use-public-availability';
import { clubToday } from '@/lib/member-form';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageError } from '@/components/club/page-error';
export default function HomePage() {
  const slots = usePublicAvailability({ date: clubToday() });
  const count = slots.data?.courts.reduce((sum, court) => sum + court.slots.filter((slot) => slot.status === 'FREE').length, 0) || 0;
  return <section className="container space-y-8 py-20"><h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">Book a court in seconds.</h1><p className="max-w-xl text-lg text-muted-foreground">Find a time for tennis, padel, badminton or cricket. See the price before you book, and enjoy more with a club membership.</p><Link href="/play" className={buttonVariants({ size: 'lg' })}>Find a free court</Link><div className="border-t pt-8">{slots.isPending ? <Skeleton className="h-10 w-64" /> : slots.error ? <PageError error={slots.error} onRetry={() => { slots.refetch(); }} /> : <p role="status" className="text-lg">{count ? `${count} free slot starts today` : 'No free slots left today. Check another date.'}</p>}</div><Link href="/plans" className={buttonVariants({ variant: 'outline' })}>Compare membership plans</Link></section>;
}
