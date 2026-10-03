'use client';

import React from 'react';
import Link from 'next/link';
import { usePlans, usePublicClub } from '@/hooks/use-plans';
import { Money } from '@/components/club/money';
import { PageError } from '@/components/club/page-error';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function PlansPage() {
  const plans = usePlans();
  const club = usePublicClub();
  const error = plans.error ?? club.error;
  const tennis = club.data?.courtTypes.find((court) => court.code === 'TENNIS');

  return (
    <div className="container space-y-8 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Find your membership</h1>
        <p className="text-muted-foreground">Compare monthly plans and choose how you want to play.</p>
      </div>
      {error ? (
        <PageError error={error} onRetry={() => { void plans.refetch(); void club.refetch(); }} />
      ) : plans.isPending || club.isPending ? (
        <div role="status" aria-label="Loading plans" className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !plans.data?.length ? (
        <EmptyState title="Plans are being updated" description="Please check back soon or contact the club." />
      ) : !tennis ? (
        <EmptyState title="Court prices are being updated" description="Contact the club for current court rates." />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Court prices below are for one hour of tennis.</p>
          <Table className="min-w-[760px]">
            <TableHeader><TableRow>
              <TableHead>Plan</TableHead><TableHead>Monthly fee</TableHead><TableHead>Court price</TableHead>
              <TableHead>Shop discount</TableHead><TableHead>Bar discount</TableHead><TableHead>Book ahead</TableHead>
              <TableHead><span className="sr-only">Enquire about a plan</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{plans.data.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell><p className="font-medium">{plan.name}</p><p className="text-xs text-muted-foreground">{plan.description}</p></TableCell>
                <TableCell><Money paise={plan.monthlyFeePaise} /></TableCell>
                <TableCell>{plan.courtDiscountPct === 100 ? 'Free play' : <Money paise={Math.round(tennis.baseRatePaise * (100 - plan.courtDiscountPct) / 100)} />}</TableCell>
                <TableCell className="tabular">{plan.shopDiscountPct}%</TableCell>
                <TableCell className="tabular">{plan.barDiscountPct}%</TableCell>
                <TableCell className="tabular">{plan.bookingHorizonDays} days</TableCell>
                <TableCell className="space-x-2 whitespace-nowrap"><Link className={buttonVariants({ size: 'sm' })} href={`/join?plan=${encodeURIComponent(plan.code)}`} aria-label={`Join ${plan.name} online`}>Join online</Link><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/contact?plan=${encodeURIComponent(plan.code)}`} aria-label={`Enquire about ${plan.name}`}>Enquire</Link></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">Junior membership is for players under 18. Booking limits and court availability apply.</p>
        </div>
      )}
    </div>
  );
}
