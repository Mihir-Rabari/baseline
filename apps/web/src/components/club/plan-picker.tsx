'use client';

import React from 'react';
import type { Plan } from '@packages/validation';
import { Money } from './money';
import { cn } from '@/lib/utils';

export function PlanPicker({ plans, value, onChange, disabled }: { plans: Plan[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return <div role="group" aria-label="Membership plan" className="space-y-2">
    {plans.filter((plan) => plan.isActive).map((plan) => <button type="button" key={plan.id} aria-pressed={value === plan.id} disabled={disabled} onClick={() => onChange(plan.id)}
      className={cn('w-full rounded-md border p-4 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50', value === plan.id ? 'border-primary' : 'border-input')}>
      <span className="flex justify-between gap-4"><span className="font-medium">{plan.name}</span><span><Money paise={plan.monthlyFeePaise} /> / month</span></span>
      <span className="mt-1 block text-sm text-muted-foreground">Court {plan.courtDiscountPct}% off · Shop {plan.shopDiscountPct}% off · Bar {plan.barDiscountPct}% off · {plan.maxBookingsPerDay} bookings/day · Book {plan.bookingHorizonDays} days ahead</span>
    </button>)}
  </div>;
}
