'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useMyMember } from '@/hooks/use-bookings';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatusBadge } from '@/components/club/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const clubDate = (date: string) => formatDate(`${date}T12:00:00+05:30`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{children}</dd></div>;
}

export default function MembershipPage() {
  const { user } = useAuth();
  const query = useMyMember(Boolean(user));
  if (!user) return null;
  const plansLink = <Button asChild><Link href="/plans">See plans</Link></Button>;
  const missing = (query.error as { statusCode?: number } | null)?.statusCode === 404;
  const member = query.data;
  const membership = member?.membership;
  const perks = member?.entitlements;
  return (
    <div className="space-y-8">
      <PageHeader title="My membership" description="Your plan, how long it runs and what it includes." />
      {missing ? <EmptyState title="No membership yet" description="Ask the front desk to set up your member profile, or look at the plans." action={plansLink} />
        : query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} />
        : query.isPending ? <div role="status" aria-label="Loading membership" className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
        : !member || !membership || !perks ? <EmptyState title="No active plan" description="Pick a plan to get member prices and booking benefits." action={plansLink} />
        : <div className="grid gap-6 md:grid-cols-2">
          <section aria-label="Plan" className="rounded-lg border p-5">
            <h2 className="text-lg font-semibold">{membership.plan.name}</h2>
            <dl className="mt-2 divide-y text-sm">
              <Row label="Status"><StatusBadge kind="membership" value={membership.expiryState} /></Row>
              <Row label="Member code"><span className="tabular">{member.memberCode}</span></Row>
              <Row label="Started">{clubDate(membership.startsOn)}</Row>
              <Row label="Ends on">{clubDate(membership.endsOn)}</Row>
              <Row label="Days left"><span className="tabular">{Math.max(0, membership.daysLeft)}</span></Row>
              {membership.pendingPlan && <Row label="Next plan">{membership.pendingPlan.name}</Row>}
            </dl>
            {membership.cancelAtPeriodEnd && <p className="mt-3 text-sm text-muted-foreground">This membership will not renew after its end date.</p>}
          </section>
          <section aria-label="What your plan includes" className="rounded-lg border p-5">
            <h2 className="text-lg font-semibold">What your plan includes</h2>
            <dl className="mt-2 divide-y text-sm">
              <Row label="Court discount"><span className="tabular">{perks.courtDiscountPct}%</span></Row>
              <Row label="Shop discount"><span className="tabular">{perks.shopDiscountPct}%</span></Row>
              <Row label="Bar discount"><span className="tabular">{perks.barDiscountPct}%</span></Row>
              <Row label="Bookings per day"><span className="tabular">{perks.maxBookingsPerDay}</span></Row>
              <Row label="Book ahead"><span className="tabular">{perks.bookingHorizonDays} days</span></Row>
            </dl>
          </section>
        </div>}
    </div>
  );
}
