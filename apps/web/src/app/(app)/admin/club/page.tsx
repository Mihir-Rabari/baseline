'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { ClubProfile, Plan, PublicClub, SocialWindow } from '@packages/validation';
import { slugify } from '@/lib/club-site';
import { CheckField, Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
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

function ClubProfileForm({ club, canEdit }: { club: PublicClub; canEdit: boolean }) {
  const [form, setForm] = useState({ name: club.name, tagline: club.tagline, phone: club.phone, address: club.address });
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<ClubProfile, object>('put', ['club', 'public'], () => '/club/profile');
  const dirty = form.name !== club.name || form.tagline !== club.tagline || form.phone !== club.phone || form.address !== club.address;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('The club needs a name.');
    try { await save.mutateAsync({ name: form.name.trim(), tagline: form.tagline.trim(), phone: form.phone.trim(), address: form.address.trim() }); toast.success('Club details saved'); }
    catch (caught) { setError(errorText(caught, 'Could not save the club details.')); }
  }
  return (
    <form onSubmit={(event) => { void submit(event); }} noValidate className="space-y-4 rounded-lg border p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="club-name" label="Club name" value={form.name} onChange={set('name')} disabled={!canEdit} hint={`The website address is /site/${slugify(form.name) || '…'}`} />
        <Field id="club-tagline" label="Tagline" value={form.tagline} onChange={set('tagline')} disabled={!canEdit} hint="The headline on the website." />
        <Field id="club-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')} disabled={!canEdit} />
        <Field id="club-address" label="Address" value={form.address} onChange={set('address')} disabled={!canEdit} />
      </div>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {canEdit && <div className="flex items-center gap-3"><Button type="submit" disabled={!dirty} loading={save.isPending}>{save.isPending ? 'Saving…' : 'Save details'}</Button>{club.name && <a className="text-sm underline-offset-4 hover:underline" href={`/site/${slugify(club.name)}`} target="_blank" rel="noreferrer">View the website</a>}</div>}
    </form>
  );
}

function PlanDialog({ plan, open, onClose }: { plan: Plan | null; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({
    name: plan?.name ?? '', fee: plan ? fromPaise(plan.monthlyFeePaise) : '', court: String(plan?.courtDiscountPct ?? 0), shop: String(plan?.shopDiscountPct ?? 0), bar: String(plan?.barDiscountPct ?? 0),
    perDay: String(plan?.maxBookingsPerDay ?? 2), ahead: String(plan?.bookingHorizonDays ?? 7), isActive: plan?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<Plan, { id: string; [key: string]: unknown }>('put', ['plans', 'public', 'members'], (v) => `/plans/${v.id}`);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit() {
    if (!plan) return;
    setError(null);
    const fee = toPaise(form.fee);
    const pct = [form.court, form.shop, form.bar].map(Number);
    const perDay = Number(form.perDay);
    const ahead = Number(form.ahead);
    if (!form.name.trim()) return setError('Enter a plan name.');
    if (!Number.isFinite(fee)) return setError('Enter the monthly fee in rupees.');
    if (pct.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return setError('Discounts are whole percentages from 0 to 100.');
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 50) return setError('Bookings a day must be between 1 and 50.');
    if (!Number.isInteger(ahead) || ahead < 1 || ahead > 365) return setError('Booking ahead must be between 1 and 365 days.');
    try {
      await save.mutateAsync({ id: plan.id, name: form.name.trim(), monthlyFeePaise: fee, courtDiscountPct: pct[0], shopDiscountPct: pct[1], barDiscountPct: pct[2], maxBookingsPerDay: perDay, bookingHorizonDays: ahead, isActive: form.isActive });
      toast.success(`${form.name.trim()} plan saved`); onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the plan.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={`Edit the ${plan?.name} plan`} description="Changes apply to members at their next booking or purchase. A 100% court discount means courts are included." onSubmit={submit} submitLabel="Save plan" pending={save.isPending} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-name" label="Name" value={form.name} onChange={set('name')} />
        <Field id="plan-fee" label="Monthly fee (₹)" inputMode="decimal" value={form.fee} onChange={set('fee')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="plan-court" label="Court discount %" inputMode="numeric" value={form.court} onChange={set('court')} />
        <Field id="plan-shop" label="Shop discount %" inputMode="numeric" value={form.shop} onChange={set('shop')} />
        <Field id="plan-bar" label="Bar discount %" inputMode="numeric" value={form.bar} onChange={set('bar')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-perday" label="Bookings a day" inputMode="numeric" value={form.perDay} onChange={set('perDay')} />
        <Field id="plan-ahead" label="Book ahead (days)" inputMode="numeric" value={form.ahead} onChange={set('ahead')} />
      </div>
      <CheckField id="plan-active" label="Offer this plan to new members" checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
    </FormDialog>
  );
}

export default function ClubSettingsPage() {
  const { user, hasPermission, isRoot } = useAuth();
  const allowed = isRoot || hasPermission('admin:access');
  const club = useOpsQuery<PublicClub>(['club', 'info'], '/public/club', { enabled: allowed });
  const windows = useOpsQuery<SocialWindow[]>(['social-windows'], '/social-windows', { enabled: allowed });
  const plans = useOpsQuery<Plan[]>(['plans'], '/plans', { enabled: allowed });
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
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
          {club.data && <ClubProfileForm key={`${club.data.name}|${club.data.tagline}|${club.data.phone}|${club.data.address}`} club={club.data} canEdit={canEdit} />}
          {club.data && <div className="grid gap-6 md:grid-cols-2">
            <dl className="divide-y rounded-lg border px-5 text-sm">
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Opening hours</dt><dd className="tabular">{club.data.hours.open} – {club.data.hours.close}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Time zone</dt><dd>{club.data.timezone}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-muted-foreground">Phone</dt><dd>{club.data.phone || '—'}</dd></div>
            </dl>
            <ul className="divide-y rounded-lg border px-5 text-sm">{club.data.courtTypes.map((t) => <li key={t.id} className="flex justify-between gap-3 py-3"><span>{t.name} · {t.courtCount} court{t.courtCount === 1 ? '' : 's'}</span><span className="tabular"><Money paise={t.baseRatePaise} />/hr · trial <Money paise={t.trialFeePaise} /></span></li>)}</ul>
          </div>}
        </QueryState>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Membership plans</h2>
        <QueryState query={{ ...plans, isEmpty: (plans.data ?? []).length === 0 }} empty={{ title: 'No plans', description: 'Plans come from the seed data.' }}>
          <div className="relative overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground"><tr><th scope="col" className="px-4 py-3 font-medium">Plan</th><th scope="col" className="px-4 py-3 text-right font-medium">Monthly</th><th scope="col" className="px-4 py-3 text-right font-medium">Court</th><th scope="col" className="px-4 py-3 text-right font-medium">Shop</th><th scope="col" className="px-4 py-3 text-right font-medium">Bar</th><th scope="col" className="px-4 py-3 text-right font-medium">Per day</th><th scope="col" className="px-4 py-3 text-right font-medium">Ahead</th><th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y">
                {(plans.data ?? []).map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="px-4 py-3 text-left font-medium">{p.name}{!p.isActive && <Badge variant="outline" className="ml-2">Hidden</Badge>}</th>
                    <td className="px-4 py-3 text-right"><Money paise={p.monthlyFeePaise} /></td>
                    <td className="px-4 py-3 text-right tabular">{p.courtDiscountPct}%</td><td className="px-4 py-3 text-right tabular">{p.shopDiscountPct}%</td><td className="px-4 py-3 text-right tabular">{p.barDiscountPct}%</td>
                    <td className="px-4 py-3 text-right tabular">{p.maxBookingsPerDay}</td><td className="px-4 py-3 text-right tabular">{p.bookingHorizonDays}d</td>
                    <td className="px-4 py-3 text-right">{hasPermission('plans:update') && <Button size="sm" variant="outline" aria-label={`Edit ${p.name}`} onClick={() => setEditingPlan(p)}>Edit</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </section>
      <PlanDialog key={`plan-${editingPlan?.id ?? 'none'}`} plan={editingPlan} open={Boolean(editingPlan)} onClose={() => setEditingPlan(null)} />
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
