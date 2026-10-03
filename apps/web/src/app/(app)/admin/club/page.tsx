'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { PublicClub, SocialWindow } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { NoAccess, QueryState, SelectBox } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TimePicker } from '@/components/ui/date-time-picker';
import { Label } from '@/components/ui/label';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function WindowRow({ window: w, canEdit }: { window: SocialWindow; canEdit: boolean }) {
  const [form, setForm] = useState({ weekday: String(w.weekday), startsTime: w.startsTime, endsTime: w.endsTime });
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<SocialWindow, { id: string; weekday?: number; startsTime?: string; endsTime?: string; isActive?: boolean }>('put', ['social-windows', 'club'], (v) => `/social-windows/${v.id}`);
  const dirty = form.weekday !== String(w.weekday) || form.startsTime !== w.startsTime || form.endsTime !== w.endsTime;
  async function run(body: { weekday?: number; startsTime?: string; endsTime?: string; isActive?: boolean }, done: string) {
    setError(null);
    try { await save.mutateAsync({ id: w.id, ...body }); toast.success(done); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.'); }
  }
  return (
    <li className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <SelectBox id={`w-day-${w.id}`} label="Day" className="w-44" disabled={!canEdit} value={form.weekday} onChange={(value) => setForm({ ...form, weekday: value })} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
        <div className="space-y-2"><Label htmlFor={`w-start-${w.id}`}>From</Label><TimePicker id={`w-start-${w.id}`} label="From" disabled={!canEdit} value={form.startsTime} onChange={(value) => setForm({ ...form, startsTime: value })} /></div>
        <div className="space-y-2"><Label htmlFor={`w-end-${w.id}`}>To</Label><TimePicker id={`w-end-${w.id}`} label="To" disabled={!canEdit} value={form.endsTime} onChange={(value) => setForm({ ...form, endsTime: value })} /></div>
        <Badge variant={w.isActive ? 'success' : 'outline'}>{w.isActive ? 'Active' : 'Paused'}</Badge>
        {canEdit && <>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => { void run({ weekday: Number(form.weekday), startsTime: form.startsTime, endsTime: form.endsTime }, 'Social window saved'); }}>Save</Button>
          <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => { void run({ isActive: !w.isActive }, w.isActive ? 'Social play paused' : 'Social play resumed'); }}>{w.isActive ? 'Pause' : 'Resume'}</Button>
        </>}
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </li>
  );
}

export default function ClubSettingsPage() {
  const { user, hasPermission, isRoot } = useAuth();
  const allowed = isRoot || hasPermission('admin:access');
  const club = useOpsQuery<PublicClub>(['club', 'info'], '/public/club', { enabled: allowed });
  const windows = useOpsQuery<SocialWindow[]>(['social-windows'], '/social-windows', { enabled: allowed });
  const expiry = useOpsMutation<{ expired: number; remindersCreated: number }, { asOf?: string }>('post', ['members', 'notifications'], () => '/admin/jobs/membership-expiry');
  const release = useOpsMutation<{ released: number; stockReturned: number }, undefined>('post', ['orders', 'products'], () => '/admin/jobs/release-unpaid-orders');
  if (!user) return null;
  if (!allowed) return <NoAccess what="club settings" />;
  const canEdit = isRoot || hasPermission('courts:update');
  return (
    <div className="space-y-8">
      <PageHeader title="Club settings" description="Opening hours, social play windows and housekeeping jobs." />
      <section className="space-y-3"><h2 className="text-lg font-semibold">The club</h2>
        <QueryState query={club}>
          {club.data && <div className="grid gap-6 md:grid-cols-2">
            <dl className="divide-y rounded-lg border px-5 text-sm">
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{club.data.name}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Opening hours</dt><dd className="tabular">{club.data.hours.open} – {club.data.hours.close}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Time zone</dt><dd>{club.data.timezone}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Phone</dt><dd>{club.data.phone || '—'}</dd></div>
            </dl>
            <ul className="divide-y rounded-lg border px-5 text-sm">{club.data.courtTypes.map((t) => <li key={t.id} className="flex justify-between gap-3 py-3"><span>{t.name} · {t.courtCount} court{t.courtCount === 1 ? '' : 's'}</span><span className="tabular"><Money paise={t.baseRatePaise} />/hr · trial <Money paise={t.trialFeePaise} /></span></li>)}</ul>
          </div>}
        </QueryState>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Social play windows</h2>
        <p className="text-sm text-muted-foreground">During a window, courts run shared sessions instead of single bookings.{!canEdit && ' Only the owner can change them.'}</p>
        <QueryState query={{ ...windows, isEmpty: (windows.data ?? []).length === 0 }} empty={{ title: 'No social windows', description: 'Social play is not scheduled on any day.' }}>
          <ul className="space-y-3">{(windows.data ?? []).map((w) => <WindowRow key={`${w.id}-${w.weekday}-${w.startsTime}-${w.endsTime}-${w.isActive}`} window={w} canEdit={canEdit} />)}</ul>
        </QueryState>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Housekeeping</h2>
        <p className="text-sm text-muted-foreground">These also run automatically every 15 minutes. Run them by hand to see the effect now.</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={expiry.isPending} onClick={() => { void expiry.mutateAsync({}).then((r) => toast.success(`${r.expired} memberships expired, ${r.remindersCreated} reminders created`)).catch((e: Error) => toast.error(e.message)); }}>Run membership expiry</Button>
          <Button variant="outline" disabled={release.isPending} onClick={() => { void release.mutateAsync(undefined).then((r) => toast.success(`${r.released} unpaid orders released, ${r.stockReturned} units back in stock`)).catch((e: Error) => toast.error(e.message)); }}>Release unpaid orders</Button>
        </div>
      </section>
    </div>
  );
}
