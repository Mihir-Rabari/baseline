'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ShoppingCart,
  ChefHat,
  Clock,
  ShieldCheck,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { usePublicAvailability } from '@/hooks/use-public-availability';
import { clubToday } from '@/lib/member-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageError } from '@/components/club/page-error';
import { cn } from '@/lib/utils';

type ShowcaseTab = 'courts' | 'pos' | 'kds' | 'reports';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ShowcaseTab>('courts');
  const slots = usePublicAvailability({ date: clubToday() });

  const freeCount =
    slots.data?.courts.reduce(
      (sum, court) => sum + court.slots.filter((slot) => slot.status === 'FREE').length,
      0
    ) || 0;

  return (
    <div className="flex flex-col space-y-20 pb-20">
      {/* Hero Section */}
      <section className="container pt-12 md:pt-20">
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span>CourtOS 2.0 &middot; Sports Club Operating System</span>
          </div>

          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-balance md:text-6xl lg:text-7xl">
            Run your entire club. From courts to kitchen.
          </h1>

          <p className="mt-6 max-w-2xl text-lg text-muted-foreground text-balance md:text-xl">
            All-in-one management for racket and multi-sport clubs. Real-time court reservations,
            walk-in POS sales, digital membership perks, live kitchen display, staff shift scheduling,
            and financial analytics.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className={buttonVariants({ size: 'lg' })}
            >
              Join the club
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              Sign in to CourtOS
            </Link>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Looking for club public booking?</span>
            <Link
              href="/site/baseline-sports-club"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              View club website
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Live Slot Proof & Availability Bar */}
        <div className="mx-auto mt-12 max-w-4xl rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Live Court Availability &middot; Today
                </span>
              </div>
              {slots.isPending ? (
                <Skeleton className="h-7 w-64" />
              ) : slots.error ? (
                <PageError error={slots.error} onRetry={() => slots.refetch()} />
              ) : (
                <p role="status" className="text-xl font-semibold tracking-tight tabular-nums">
                  {freeCount ? `${freeCount} free slot starts today` : 'No free slots left today. Check another date.'}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Link href="/play" className={buttonVariants({ size: 'default' })}>
                Find a free court
              </Link>
              <Link href="/courts" className={buttonVariants({ variant: 'outline', size: 'default' })}>
                Staff slot grid
              </Link>
            </div>
          </div>

          {/* Quick Slot Preview Strip */}
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border bg-background p-3 text-left">
              <div className="text-xs font-medium text-muted-foreground">Court 1 &middot; Tennis</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-xs">17:00 - 18:00</span>
                <Badge variant="outline" className="border-primary/30 text-primary">Free</Badge>
              </div>
            </div>
            <div className="rounded-lg border bg-background p-3 text-left">
              <div className="text-xs font-medium text-muted-foreground">Court 2 &middot; Padel</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-xs">18:30 - 19:30</span>
                <Badge variant="secondary">Booked</Badge>
              </div>
            </div>
            <div className="rounded-lg border bg-background p-3 text-left">
              <div className="text-xs font-medium text-muted-foreground">Court 3 &middot; Squash</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-xs">19:00 - 20:00</span>
                <Badge variant="outline" className="border-primary/30 text-primary">Free</Badge>
              </div>
            </div>
            <div className="rounded-lg border bg-background p-3 text-left">
              <div className="text-xs font-medium text-muted-foreground">Court 4 &middot; Badminton</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-xs">20:00 - 21:00</span>
                <Badge variant="outline" className="border-warning/30 text-warning">Social 2/8</Badge>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive System Showcase */}
      <section className="container">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Everything your facility needs in one workspace
          </h2>
          <p className="mt-2 text-muted-foreground">
            Engineered specifically for tennis centres, padel arenas, and multi-sport racket clubs.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="mx-auto mt-8 flex max-w-xl justify-center rounded-lg border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('courts')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              activeTab === 'courts'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Courts & Slots
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              activeTab === 'pos'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Counter POS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('kds')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              activeTab === 'kds'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Bar & Kitchen
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              activeTab === 'reports'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Owner Reports
          </button>
        </div>

        {/* Tab Content Mockups */}
        <div className="mx-auto mt-6 max-w-5xl rounded-xl border bg-card p-6 shadow-sm md:p-8">
          {activeTab === 'courts' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">Court Schedule & Slot Matrix</h3>
                  <p className="text-sm text-muted-foreground">30-minute intervals, participant pricing, and instant conflict resolution.</p>
                </div>
                <Link href="/courts" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Open court planner
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Center Clay 1</span>
                    <span className="text-xs text-muted-foreground">Tennis &middot; Outdoor</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="rounded border bg-primary/10 border-primary/20 p-2 text-xs">
                      <div className="font-semibold text-primary">16:00 - 17:00 &middot; Free slot</div>
                      <div className="text-muted-foreground">Member: ₹420 &middot; Guest: ₹600</div>
                    </div>
                    <div className="rounded border bg-muted p-2 text-xs">
                      <div className="font-medium">17:00 - 18:30 &middot; Coaching Clinic</div>
                      <div className="text-muted-foreground">Coach Rahul M. (8 players)</div>
                    </div>
                    <div className="rounded border bg-primary/10 border-primary/20 p-2 text-xs">
                      <div className="font-semibold text-primary">18:30 - 19:30 &middot; Free slot</div>
                      <div className="text-muted-foreground">Peak rate: ₹800</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Panoramic Padel 1</span>
                    <span className="text-xs text-muted-foreground">Padel &middot; Indoor</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="rounded border bg-muted p-2 text-xs">
                      <div className="font-medium">16:30 - 18:00 &middot; Member Match</div>
                      <div className="text-muted-foreground">Vikram S. &middot; Gold Tier</div>
                    </div>
                    <div className="rounded border bg-warning/10 border-warning/20 p-2 text-xs">
                      <div className="font-semibold text-warning">18:00 - 19:30 &middot; Social Mix-in</div>
                      <div className="text-muted-foreground">6 of 8 spots filled</div>
                    </div>
                    <div className="rounded border bg-primary/10 border-primary/20 p-2 text-xs">
                      <div className="font-semibold text-primary">19:30 - 21:00 &middot; Free slot</div>
                      <div className="text-muted-foreground">Member: ₹700 &middot; Guest: ₹1,000</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Glass Squash 2</span>
                    <span className="text-xs text-muted-foreground">Squash &middot; AC</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="rounded border bg-primary/10 border-primary/20 p-2 text-xs">
                      <div className="font-semibold text-primary">17:00 - 18:00 &middot; Free slot</div>
                      <div className="text-muted-foreground">Member: ₹350 &middot; Guest: ₹500</div>
                    </div>
                    <div className="rounded border bg-muted p-2 text-xs">
                      <div className="font-medium">18:00 - 19:00 &middot; League Ladder</div>
                      <div className="text-muted-foreground">Division 1 Playoffs</div>
                    </div>
                    <div className="rounded border bg-muted p-2 text-xs">
                      <div className="font-medium">19:00 - 20:00 &middot; Private Lesson</div>
                      <div className="text-muted-foreground">Coach Ananya P.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pos' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">Rapid Counter Checkout & Pro Shop</h3>
                  <p className="text-sm text-muted-foreground">Instant member lookup, automated tier discounts, and stock decrements.</p>
                </div>
                <Link href="/pos" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Open counter POS
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Cart &middot; Member #MEM-1082 (Gold Tier)</div>
                  <div className="divide-y rounded-lg border">
                    <div className="flex items-center justify-between p-3 text-sm">
                      <div>
                        <div className="font-medium">Wilson US Open Balls (3-pack)</div>
                        <div className="text-xs text-muted-foreground">Qty: 2 &middot; Regular: ₹900</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono tabular-nums font-semibold">₹765</div>
                        <div className="text-xs text-primary">15% Gold Discount</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 text-sm">
                      <div>
                        <div className="font-medium">Tourna Grip XL (3-pack)</div>
                        <div className="text-xs text-muted-foreground">Qty: 1 &middot; Regular: ₹450</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono tabular-nums font-semibold">₹382</div>
                        <div className="text-xs text-primary">15% Gold Discount</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 text-sm">
                      <div>
                        <div className="font-medium">Electrolyte Hydration Drink 500ml</div>
                        <div className="text-xs text-muted-foreground">Qty: 2 &middot; Regular: ₹120</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono tabular-nums font-semibold">₹102</div>
                        <div className="text-xs text-primary">15% Gold Discount</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-lg border bg-muted/30 p-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order Summary</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal (before perks)</span>
                      <span className="font-mono tabular-nums">₹1,470</span>
                    </div>
                    <div className="flex justify-between text-sm text-primary">
                      <span>Gold Member Savings (15%)</span>
                      <span className="font-mono tabular-nums">-₹221</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">GST (18% inclusive)</span>
                      <span className="font-mono tabular-nums">₹190.52</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-semibold">
                      <span>Total Payable</span>
                      <span className="font-mono text-lg tabular-nums">₹1,249</span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" className="w-full">Pay with UPI</Button>
                    <Button size="sm" className="w-full">Charge Member Tab</Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'kds' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">Kitchen & Bar Display System (KDS)</h3>
                  <p className="text-sm text-muted-foreground">Real-time digital ticket queue with court delivery and split-bill settling.</p>
                </div>
                <Link href="/bar/kitchen" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Open kitchen display
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold font-mono">#ORD-402</span>
                    <Badge variant="outline" className="border-warning text-warning">Preparing</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Deliver to: Court 1 Bench</div>
                  <div className="mt-3 space-y-1 text-sm border-t pt-2">
                    <div className="flex justify-between"><span>2x Espresso Tonic</span><span className="font-mono">x2</span></div>
                    <div className="flex justify-between"><span>1x Grilled Chicken Wrap</span><span className="font-mono">x1</span></div>
                  </div>
                  <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
                    <span>Elapsed: 8 min</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs">Mark Ready</Button>
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold font-mono">#ORD-403</span>
                    <Badge variant="outline" className="border-destructive text-destructive">Urgent</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Deliver to: Table 4 (Lounge)</div>
                  <div className="mt-3 space-y-1 text-sm border-t pt-2">
                    <div className="flex justify-between"><span>1x Protein Shake (Banana)</span><span className="font-mono">x1</span></div>
                    <div className="flex justify-between"><span>2x Cold Brew Coffee</span><span className="font-mono">x2</span></div>
                  </div>
                  <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
                    <span>Elapsed: 14 min</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs">Mark Ready</Button>
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold font-mono">#ORD-404</span>
                    <Badge variant="secondary">Queued</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Deliver to: Padel Court 2</div>
                  <div className="mt-3 space-y-1 text-sm border-t pt-2">
                    <div className="flex justify-between"><span>4x Fresh Lime Soda</span><span className="font-mono">x4</span></div>
                    <div className="flex justify-between"><span>1x Energy Bar Box</span><span className="font-mono">x1</span></div>
                  </div>
                  <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
                    <span>Elapsed: 2 min</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs">Start Prep</Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">Executive Intelligence & Revenue Analytics</h3>
                  <p className="text-sm text-muted-foreground">Court utilization heatmaps, member renewal rates, and daily F&B margins.</p>
                </div>
                <Link href="/reports" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  View full reports
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">Today Revenue</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">₹48,920</div>
                  <div className="mt-1 text-xs text-primary">+18.4% vs last week</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">Court Occupancy</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">84.2%</div>
                  <div className="mt-1 text-xs text-muted-foreground">Peak hours 100% full</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">Active Members</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">348</div>
                  <div className="mt-1 text-xs text-primary">+12 this month</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">F&B Average Tab</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">₹840</div>
                  <div className="mt-1 text-xs text-muted-foreground">Across 42 tables</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Operational Pulse / Metrics */}
      <section className="container">
        <div className="grid grid-cols-2 gap-4 rounded-xl border bg-muted/20 p-8 sm:grid-cols-4">
          <div className="space-y-1 text-center">
            <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">4+</div>
            <div className="text-xs font-medium text-muted-foreground">Racket Sports Supported</div>
          </div>
          <div className="space-y-1 text-center">
            <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">&lt;150ms</div>
            <div className="text-xs font-medium text-muted-foreground">Slot Booking Latency</div>
          </div>
          <div className="space-y-1 text-center">
            <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">0</div>
            <div className="text-xs font-medium text-muted-foreground">Double-Booking Risk</div>
          </div>
          <div className="space-y-1 text-center">
            <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">100%</div>
            <div className="text-xs font-medium text-muted-foreground">Deterministic IAM Security</div>
          </div>
        </div>
      </section>

      {/* Operational Pillars */}
      <section className="container space-y-12">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Built for how modern clubs actually run
          </h2>
          <p className="mt-2 text-muted-foreground">
            No bloated generic ERP. Every feature is tuned to courts, players, staff shifts, and hospitality.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CalendarDays className="h-6 w-6 text-primary" />
              <CardTitle className="mt-4">Dynamic Court Allocation</CardTitle>
              <CardDescription>
                Flexible 30 to 90 minute booking windows with member discount pricing, guest surcharges, and social match quotas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Real-time conflict prevention</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Configurable peak and off-peak tariffs</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Public shareable match invitations</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <ShoppingCart className="h-6 w-6 text-primary" />
              <CardTitle className="mt-4">Integrated Pro Shop & POS</CardTitle>
              <CardDescription>
                Sell equipment, restringing, apparel, and refreshments directly at the reception counter with automatic member billing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Instant barcode/SKU inventory adjustment</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Gold, Silver & Junior tiered perks</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>GST tax compliance and invoice logging</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <ChefHat className="h-6 w-6 text-primary" />
              <CardTitle className="mt-4">Court-Side Bar & Kitchen</CardTitle>
              <CardDescription>
                Manage café tabs, drinks, and kitchen preparation with dedicated KDS order boards and floor tab tracking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Live ticket statuses with elapsed timers</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Court delivery markers and tab splits</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>End-of-shift cash & card drawer audit</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Clock className="h-6 w-6 text-primary" />
              <CardTitle className="mt-4">Shift Rostering & Attendance</CardTitle>
              <CardDescription>
                Schedule front desk coordinators, coaches, and kitchen staff with accurate IST timestamps and clock in/out tracking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>One-click staff clock in and out</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Leave balances and approval workflows</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Shift calendar with overlap detection</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <ShieldCheck className="h-6 w-6 text-primary" />
              <CardTitle className="mt-4">Deterministic IAM Security</CardTitle>
              <CardDescription>
                Centralized authorization policy engine. Every endpoint and button strictly enforces role permissions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Owner, Staff, Bar, and Member isolation</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Self-resource scoping protection</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Audit-logged credential security</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <BarChart3 className="h-6 w-6 text-primary" />
              <CardTitle className="mt-4">Revenue & Utilization KPIs</CardTitle>
              <CardDescription>
                Comprehensive owner analytics covering court utilization, membership renewals, and multi-department margins.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Court revenue heatmaps and peak analysis</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Member churn and retention tracking</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Instant CSV export for accounting</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Role Showcase */}
      <section className="container space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Built for every role in your facility
          </h2>
          <p className="mt-2 text-muted-foreground">
            Role-tailored interfaces designed specifically for club owners, front desk staff, hospitality teams, and players.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">Club Owner</span>
                <Badge variant="outline">Executive</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Total operational oversight, daily revenue charts, shift approvals, and settings.
              </p>
            </div>
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Executive dashboard &amp; analytics
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">Front Desk</span>
                <Badge variant="secondary">Operations</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Fast court reservations, member lookups, pro-shop sales, and walk-in check-in.
              </p>
            </div>
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Real-time POS &amp; court desk
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">Bar & Kitchen</span>
                <Badge variant="outline">Hospitality</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Open table tabs, kitchen order ticket display, floor orders, and shift clock-in.
              </p>
            </div>
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Live KDS &amp; bar tab management
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">Club Member</span>
                <Badge variant="secondary">Member</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Book courts with tier discount, view active plan benefits, and invite friends.
              </p>
            </div>
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Member portal &amp; court reservations
            </div>
          </div>
        </div>
      </section>

      {/* Closing Call to Action */}
      <section className="container">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm sm:p-14">
          <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
            Ready to upgrade your club operations?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Get started with CourtOS today and experience seamless club management from courts to kitchen.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/signup"
              className={buttonVariants({ size: 'lg' })}
            >
              Join the club
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
