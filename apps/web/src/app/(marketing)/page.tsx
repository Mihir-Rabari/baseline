import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { buttonVariants } from '@/components/ui/button';

const MODULES = [
  {
    id: 'bookings',
    title: 'A schedule that fills itself',
    body: 'Members and walk-ins book courts online, see the price before they pay, and join social sessions. Staff see every court, every hour, on one grid, with clashes and double bookings ruled out.',
    points: ['Court grid with live availability', 'Member discounts and social windows applied automatically', 'Cancellations, refunds and receipts in one place'],
    image: '/images/landing/courts.webp',
    alt: 'Three outdoor blue tennis courts with nets and green surrounds',
    width: 1600,
    height: 1200,
  },
  {
    id: 'members',
    title: 'Know every member',
    body: 'Plans, renewals, check-ins and history sit on one profile. The front desk finds anyone in seconds and sees who is about to lapse before they do.',
    points: ['Membership plans, expiry reminders and renewals', 'Lead pipeline from first enquiry to signed member', 'Staff, shifts, leave and payroll alongside'],
    image: '/images/landing/social-play.webp',
    alt: 'Two players facing each other across an outdoor tennis court',
    width: 1000,
    height: 1333,
  },
  {
    id: 'sales',
    title: 'Every sale, one till',
    body: 'Ring up the shop, the bar and the kitchen from the same counter. Stock counts down as you sell, tabs stay open at the table, and the day closes with numbers that add up.',
    points: ['Counter sales, bar tabs and kitchen tickets', 'Inventory with low-stock alerts', 'Invoices and reports by day, source and payment mode'],
    image: '/images/landing/racket.webp',
    alt: 'Two tennis rackets and balls resting on a court',
    width: 900,
    height: 675,
  },
] as const;

const EXTRAS = [
  ['Your own site', 'A public page for your club with your logo, colours and court times, on your own domain.'],
  ['Roles and access', 'Owners, front desk, bar and members each see only what their job needs.'],
  ['Assistant', 'Ask a question in plain words and get an answer from your own club data. Changes wait for your approval.'],
  ['Live dashboard', 'Revenue, occupancy, who is on shift and what needs attention, refreshed as it happens.'],
] as const;

export default function HomePage() {
  return <div className="container space-y-20 py-12 md:py-16">
    <section aria-labelledby="landing-title" className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
      <div className="min-w-0 space-y-6">
        <h1 id="landing-title" className="text-4xl font-semibold tracking-tight md:text-6xl">Run your whole sports club from one place.</h1>
        <p className="max-w-xl text-lg text-muted-foreground">Baseline brings court bookings, memberships, the shop and bar, staff and reporting together, so the club runs smoothly and you spend less time on admin.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className={buttonVariants({ size: 'lg' })}>Sign in to your club</Link>
          <Link href="/play" className={buttonVariants({ size: 'lg', variant: 'outline' })}>See court booking</Link>
        </div>
      </div>
      <Image src="/images/landing/courts.webp" alt="Three outdoor blue tennis courts with nets and green surrounds" width={1600} height={1200} sizes="(min-width: 1280px) 608px, (min-width: 1024px) 50vw, 100vw" preload className="aspect-[4/3] w-full rounded-lg object-cover" />
    </section>

    {MODULES.map((m, i) => <section key={m.id} aria-labelledby={`${m.id}-title`} className="grid items-center gap-8 border-t pt-12 lg:grid-cols-2 lg:gap-14">
      <div className={`min-w-0 space-y-5 ${i % 2 ? 'lg:order-2' : ''}`}>
        <h2 id={`${m.id}-title`} className="text-2xl font-semibold tracking-tight md:text-3xl">{m.title}</h2>
        <p className="text-muted-foreground">{m.body}</p>
        <ul className="divide-y text-sm">{m.points.map((p) => <li key={p} className="py-2.5">{p}</li>)}</ul>
      </div>
      <Image src={m.image} alt={m.alt} width={m.width} height={m.height} sizes="(min-width: 1280px) 608px, (min-width: 1024px) 50vw, 100vw" className="aspect-[4/3] w-full rounded-lg object-cover" />
    </section>)}

    <section aria-labelledby="more-title" className="space-y-6 border-t pt-12">
      <h2 id="more-title" className="text-2xl font-semibold tracking-tight md:text-3xl">And the rest of the job</h2>
      <dl className="grid gap-x-12 sm:grid-cols-2">{EXTRAS.map(([t, d]) => <div key={t} className="border-b py-4"><dt className="font-medium">{t}</dt><dd className="mt-1 text-sm text-muted-foreground">{d}</dd></div>)}</dl>
    </section>

    <section aria-labelledby="cta-title" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/30 p-8">
      <div className="max-w-xl space-y-1"><h2 id="cta-title" className="text-2xl font-semibold tracking-tight">Ready to see it with your club?</h2><p className="text-muted-foreground">Sign in to open the workspace, or look at the booking experience your members get.</p></div>
      <div className="flex flex-wrap gap-3"><Link href="/login" className={buttonVariants({ size: 'lg' })}>Sign in</Link><Link href="/play" className={buttonVariants({ size: 'lg', variant: 'outline' })}>See court booking</Link></div>
    </section>
  </div>;
}
