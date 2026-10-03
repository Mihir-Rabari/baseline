'use client';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePublicAvailability } from '@/hooks/use-public-availability';
import { clubToday } from '@/lib/member-form';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageError } from '@/components/club/page-error';
export default function HomePage() {
  const slots = usePublicAvailability({ date: clubToday() });
  const count = slots.data?.courts.reduce((sum, court) => sum + court.slots.filter((slot) => slot.status === 'FREE').length, 0) || 0;
  return <div className="container space-y-16 py-12 md:space-y-20 md:py-16">
    <section aria-labelledby="landing-title" className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
      <div className="min-w-0 space-y-6">
        <h1 id="landing-title" className="text-4xl font-semibold tracking-tight md:text-6xl">Book a court in seconds.</h1>
        <p className="max-w-xl text-lg text-muted-foreground">Find a time for tennis, padel, badminton or cricket. See the price before you book, and enjoy more with a club membership.</p>
        <Link href="/play" className={buttonVariants({ size: 'lg' })}>Find a free court</Link>
        <div className="border-t pt-6" aria-live="polite">
          {slots.isPending ? <div role="status" aria-label="Checking today's court availability"><Skeleton className="h-10 w-full max-w-64" /></div>
            : slots.error ? <PageError error={slots.error} onRetry={() => { void slots.refetch(); }} />
            : <p role="status" className="text-lg">{count ? `${count} free slot starts today` : 'No free slots left today. Check another date.'}</p>}
        </div>
      </div>
      <Image src="/images/landing/courts.webp" alt="Three outdoor blue tennis courts with nets and green surrounds" width={1600} height={1200} sizes="(min-width: 1280px) 608px, (min-width: 1024px) 50vw, 100vw" preload className="aspect-[4/3] w-full rounded-lg object-cover" />
    </section>
    <section aria-labelledby="club-life-title" className="space-y-6 border-t pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl space-y-2"><h2 id="club-life-title" className="text-2xl font-semibold tracking-tight">Make time to play.</h2><p className="text-muted-foreground">A match with friends, a regular court slot or gear for your next game.</p></div>
        <Link href="/plans" className={buttonVariants({ variant: 'outline' })}>Compare membership plans</Link>
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <article className="min-w-0 space-y-4">
          <Image src="/images/landing/social-play.webp" alt="Two players facing each other across an outdoor tennis court" width={1000} height={1333} sizes="(min-width: 1280px) 624px, (min-width: 768px) 50vw, 100vw" className="aspect-square w-full rounded-lg object-cover object-center" />
          <h3 className="text-lg font-semibold">Meet on court</h3><p className="text-muted-foreground">Find a time that works for you and make your next match a regular part of the week.</p><Link href="/play" className="font-medium underline underline-offset-4">Explore court times</Link>
        </article>
        <article className="min-w-0 space-y-4">
          <Image src="/images/landing/racket.webp" alt="Two tennis rackets and balls resting on a court" width={900} height={675} sizes="(min-width: 1280px) 624px, (min-width: 768px) 50vw, 100vw" className="aspect-square w-full rounded-lg object-cover" />
          <h3 className="text-lg font-semibold">Ready for your next game</h3><p className="text-muted-foreground">Browse the club shop for rackets, balls and other court essentials.</p><Link href="/shop" className="font-medium underline underline-offset-4">Browse the shop</Link>
        </article>
      </div>
    </section>
  </div>;
}
