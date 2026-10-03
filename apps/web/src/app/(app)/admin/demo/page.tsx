'use client';
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { bookingApi } from '@/lib/booking-api';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export default function DemoPage() {
  const { user, hasPermission } = useAuth(); const [courtId, setCourt] = useState(''); const [startsAt, setStart] = useState('');
  const mutation = useMutation({ mutationFn: () => { if (!hasPermission('admin:access')) throw new Error('Access denied'); return bookingApi.race({ courtId, startsAt: new Date(startsAt).toISOString(), attempts: 20 }); } });
  if (!user) return null;
  return <div className="space-y-6"><PageHeader title="Booking race" description="Send 20 competing requests for one court slot." />{!hasPermission('admin:access') || process.env.NODE_ENV === 'production' ? <EmptyState title="Demo unavailable" description="This tool requires an administrator and a development server." /> : <><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}><Label htmlFor="race-court">Court ID</Label><Input id="race-court" placeholder="Court ID (UUID)" aria-required="true" value={courtId} onChange={(e) => setCourt(e.target.value)} required disabled={mutation.isPending} /><Label htmlFor="race-start">Start time (UTC ISO timestamp)</Label><Input id="race-start" placeholder="2026-10-09T12:30:00.000Z" value={startsAt} onChange={(e) => setStart(e.target.value)} required disabled={mutation.isPending} /><Button disabled={mutation.isPending}>{mutation.isPending ? 'Running…' : 'Run race'}</Button></form>{mutation.error && <PageError error={mutation.error} />}{mutation.data && <p role="status">{mutation.data.confirmed} confirmed · {mutation.data.slotTaken} slot taken · {mutation.data.other} other · {mutation.data.durationMs} ms</p>}</>}</div>;
}
