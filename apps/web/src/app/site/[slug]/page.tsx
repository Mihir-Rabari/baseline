import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Plan } from '@packages/validation';
import { buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Money } from '@/components/club/money';
import { brandingStyle } from '@/lib/branding';
import { mediaUrl } from '@/lib/upload-api';
import { WEEKDAYS, clockTime, getClubSite, hoursText, joinList, slugify, telHref } from '@/lib/club-site';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const site = await getClubSite();
  if (!site || slugify(site.club.name) !== slug) return { title: 'Club not found' };
  return { title: site.club.name, description: site.club.tagline || `Courts, coaching and membership at ${site.club.name}.` };
}

const discount = (pct: number, what: string) => (pct >= 100 ? `${what} included` : pct > 0 ? `${pct}% off` : '—');
const ageNote = (plan: Plan) => (plan.maxAge != null ? `Under ${plan.maxAge + 1}s` : plan.minAge != null ? `${plan.minAge}+` : null);

export default async function ClubSitePage({ params }: Params) {
  const { slug } = await params;
  const site = await getClubSite();
  if (!site || slugify(site.club.name) !== slug) notFound();
  const { club, plans, products, freeToday, branding } = site;

  const totalCourts = club.courtTypes.reduce((sum, type) => sum + type.courtCount, 0);
  const sports = club.courtTypes.map((type) => type.name);
  const fromRate = club.courtTypes.length ? Math.min(...club.courtTypes.map((type) => type.baseRatePaise)) : null;
  const freeCount = freeToday ? Object.values(freeToday).reduce((sum, n) => sum + n, 0) : null;
  const social = club.socialPlay;
  const cheapestTrial = club.courtTypes.length ? Math.min(...club.courtTypes.map((type) => type.trialFeePaise)) : null;
  const headline = club.tagline || `Play more at ${club.name}.`;

  return (
    <div className="flex min-h-screen flex-col" style={brandingStyle(branding) as React.CSSProperties}>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="container flex h-14 items-center justify-between gap-4">
          <Link href={`/site/${slug}`} className="flex items-center gap-2 font-semibold tracking-tight">{branding?.logoUrl && <img src={mediaUrl(branding.logoUrl) ?? ''} alt="" className="h-7 w-7 rounded object-cover" />}{club.name}</Link>
          <nav aria-label="Sections" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#courts" className="transition-colors hover:text-foreground">Courts</a>
            {plans.length > 0 && <a href="#membership" className="transition-colors hover:text-foreground">Membership</a>}
            <a href="#visit" className="transition-colors hover:text-foreground">Visit</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Sign in</Link>
            <Link href="/play" className={buttonVariants({ size: 'sm' })}>Book a trial</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="container space-y-6 py-16 md:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">{headline}</h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            {totalCourts > 0 ? `${totalCourts} courts for ${joinList(sports.map((s) => s.toLowerCase()))}, ` : 'Courts, '}open every day, {hoursText(club)}.
            Come for a trial session, or join as a member and play for less.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link href="/play" className={buttonVariants({ size: 'lg' })}>Book a trial session</Link>
            {plans.length > 0 && <a href="#membership" className={buttonVariants({ size: 'lg', variant: 'outline' })}>See membership</a>}
          </div>
          <dl className="grid max-w-3xl grid-cols-2 gap-x-8 gap-y-4 border-t pt-6 text-sm md:grid-cols-4">
            <div><dt className="text-muted-foreground">Courts</dt><dd className="mt-1 text-2xl font-semibold tabular">{totalCourts}</dd></div>
            <div><dt className="text-muted-foreground">Open daily</dt><dd className="mt-1 text-2xl font-semibold tabular">{clockTime(club.hours.open)} – {clockTime(club.hours.close)}</dd></div>
            {fromRate !== null && <div><dt className="text-muted-foreground">Courts from</dt><dd className="mt-1 text-2xl font-semibold"><Money paise={fromRate} /><span className="text-sm font-normal text-muted-foreground"> an hour</span></dd></div>}
            {freeCount !== null && <div><dt className="text-muted-foreground">Free sessions today</dt><dd className="mt-1 text-2xl font-semibold tabular">{freeCount}</dd></div>}
          </dl>
        </section>

        <section id="courts" className="border-t bg-muted/30" aria-labelledby="courts-heading">
          <div className="container space-y-6 py-16">
            <div className="max-w-xl space-y-2">
              <h2 id="courts-heading" className="text-2xl font-semibold tracking-tight">Courts and prices</h2>
              <p className="text-muted-foreground">Sessions run for one hour. A trial session is a first visit at a lower price, paid at the club.</p>
            </div>
            {club.courtTypes.length === 0 ? <p className="text-muted-foreground">Court prices are being set up. Call us for rates.</p> : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-muted-foreground"><tr className="border-b"><th scope="col" className="py-3 pr-4 font-medium">Sport</th><th scope="col" className="py-3 pr-4 font-medium">Courts</th><th scope="col" className="py-3 pr-4 text-right font-medium">Per hour</th><th scope="col" className="py-3 pr-4 text-right font-medium">Trial session</th>{freeToday && <th scope="col" className="py-3 text-right font-medium">Free today</th>}</tr></thead>
                  <tbody className="divide-y">
                    {club.courtTypes.map((type) => (
                      <tr key={type.id}>
                        <th scope="row" className="py-3 pr-4 text-left font-medium">{type.name}</th>
                        <td className="py-3 pr-4 tabular">{type.courtCount}</td>
                        <td className="py-3 pr-4 text-right"><Money paise={type.baseRatePaise} /></td>
                        <td className="py-3 pr-4 text-right"><Money paise={type.trialFeePaise} /></td>
                        {freeToday && <td className="py-3 text-right tabular">{freeToday[type.code] ?? 0}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Link href="/play" className={buttonVariants({ variant: 'outline' })}>See free times this week</Link>
          </div>
        </section>

        <section className="border-t" aria-labelledby="social-heading">
          <div className="container grid gap-6 py-16 md:grid-cols-2">
            <h2 id="social-heading" className="text-2xl font-semibold tracking-tight">Social play on {WEEKDAYS[social.weekday]}s</h2>
            <p className="max-w-prose text-muted-foreground">
              {WEEKDAYS[social.weekday]}s, {clockTime(social.startsTime)} to {clockTime(social.endsTime)}, the courts run shared sessions. Turn up on your own, book a place and play with whoever else is there.
            </p>
          </div>
        </section>

        {plans.length > 0 && (
          <section id="membership" className="border-t bg-muted/30" aria-labelledby="membership-heading">
            <div className="container space-y-6 py-16">
              <div className="max-w-xl space-y-2">
                <h2 id="membership-heading" className="text-2xl font-semibold tracking-tight">Membership</h2>
                <p className="text-muted-foreground">Members book further ahead and pay less for courts, the shop and the bar.</p>
              </div>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-muted-foreground"><tr className="border-b"><th scope="col" className="py-3 pr-4 font-medium">Plan</th><th scope="col" className="py-3 pr-4 text-right font-medium">Monthly</th><th scope="col" className="py-3 pr-4 font-medium">Courts</th><th scope="col" className="py-3 pr-4 font-medium">Shop</th><th scope="col" className="py-3 pr-4 font-medium">Bar</th><th scope="col" className="py-3 pr-4 text-right font-medium">Bookings a day</th><th scope="col" className="py-3 pr-4 text-right font-medium">Book ahead</th><th scope="col" className="py-3"><span className="sr-only">Enquire</span></th></tr></thead>
                  <tbody className="divide-y">
                    {plans.map((plan) => (
                      <tr key={plan.id}>
                        <th scope="row" className="py-3 pr-4 text-left font-medium">{plan.name}{ageNote(plan) && <span className="block text-xs font-normal text-muted-foreground">{ageNote(plan)}</span>}{plan.description && <span className="block max-w-56 text-xs font-normal text-muted-foreground">{plan.description}</span>}</th>
                        <td className="py-3 pr-4 text-right"><Money paise={plan.monthlyFeePaise} /></td>
                        <td className="py-3 pr-4">{discount(plan.courtDiscountPct, 'Courts')}</td>
                        <td className="py-3 pr-4">{discount(plan.shopDiscountPct, 'Shop')}</td>
                        <td className="py-3 pr-4">{discount(plan.barDiscountPct, 'Bar')}</td>
                        <td className="py-3 pr-4 text-right tabular">{plan.maxBookingsPerDay}</td>
                        <td className="py-3 pr-4 text-right tabular">{plan.bookingHorizonDays} days</td>
                        <td className="space-x-2 whitespace-nowrap py-3 text-right"><Link href={`/join?plan=${encodeURIComponent(plan.code)}`} className={buttonVariants({ size: 'sm' })} aria-label={`Join ${plan.name} online`}>Join online</Link><Link href={`/contact?plan=${encodeURIComponent(plan.code)}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} aria-label={`Ask about ${plan.name}`}>Ask about it</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {products.length > 0 && (
          <section className="border-t" aria-labelledby="shop-heading">
            <div className="container space-y-6 py-16">
              <div className="max-w-xl space-y-2">
                <h2 id="shop-heading" className="text-2xl font-semibold tracking-tight">In the pro shop</h2>
                <p className="text-muted-foreground">Rackets, shoes and kit, available at the front desk. Members get their discount at the till.</p>
              </div>
              <ul className="grid gap-x-10 divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
                {products.slice(0, 6).map((product) => (
                  <li key={product.id} className="flex items-baseline justify-between gap-4 border-b py-3 text-sm">
                    <span>{product.name}</span><Money paise={product.pricePaise} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section id="visit" className="border-t bg-muted/30" aria-labelledby="visit-heading">
          <div className="container grid gap-8 py-16 md:grid-cols-2">
            <div className="space-y-3">
              <h2 id="visit-heading" className="text-2xl font-semibold tracking-tight">Visit {club.name}</h2>
              <p className="max-w-md text-muted-foreground">Walk in any day, or book a trial session first so a court is waiting for you.</p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link href="/play" className={buttonVariants({ size: 'lg' })}>Book a trial session</Link>
                <Link href="/contact" className={buttonVariants({ size: 'lg', variant: 'outline' })}>Send an enquiry</Link>
              </div>
            </div>
            <dl className="divide-y text-sm">
              {club.address && <div className="flex justify-between gap-6 py-3"><dt className="text-muted-foreground">Address</dt><dd className="text-right">{club.address}</dd></div>}
              {club.phone && <div className="flex justify-between gap-6 py-3"><dt className="text-muted-foreground">Phone</dt><dd><a className="underline-offset-4 hover:underline" href={telHref(club.phone)}>{club.phone}</a></dd></div>}
              <div className="flex justify-between gap-6 py-3"><dt className="text-muted-foreground">Open</dt><dd className="text-right">Every day, {hoursText(club)}</dd></div>
              {cheapestTrial !== null && <div className="flex justify-between gap-6 py-3"><dt className="text-muted-foreground">Trial sessions from</dt><dd><Money paise={cheapestTrial} /></dd></div>}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-muted-foreground">
          <span>{club.name}</span>
          <nav aria-label="Footer" className="flex gap-4"><Link href="/contact" className="hover:text-foreground">Contact</Link><Link href="/login" className="hover:text-foreground">Member sign in</Link></nav>
        </div>
      </footer>
    </div>
  );
}
