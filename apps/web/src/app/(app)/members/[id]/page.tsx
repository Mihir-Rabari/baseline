'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import type { PaymentMethod } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useMemberProfile, useMemberTimeline, useMemberCheckin, useMemberRenewal } from '@/hooks/use-member-profile';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatusBadge } from '@/components/club/status-badge';
import { Money } from '@/components/club/money';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { formatDate, formatDateTime } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import type { Member } from '@packages/validation';
import { useOpsMutation } from '@/hooks/use-ops';
import { calendarDate } from '@/lib/booking-calendar';
import { DatePicker } from '@/components/ui/date-picker';
import { Field as FormField, FormDialog, errorText } from '@/components/club/form-dialog';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd>{children}</dd></div>;
}

function EditMemberDialog({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ fullName: member.fullName, phone: member.phone, email: member.email ?? '', dateOfBirth: member.dateOfBirth ?? '' });
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<Member, { id: string; [key: string]: unknown }>('patch', ['members'], (v) => `/members/${v.id}`);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit() {
    setError(null);
    if (!form.fullName.trim()) return setError('Enter the member\'s name.');
    if (!form.phone.trim()) return setError('Enter a phone number.');
    try {
      await save.mutateAsync({ id: member.id, fullName: form.fullName.trim(), phone: form.phone.trim(), ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}) });
      toast.success('Member details saved'); onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the member.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={`Edit ${member.fullName}`} description="Contact details and date of birth. The plan is changed by renewing." onSubmit={submit} submitLabel="Save changes" pending={save.isPending} error={error}>
      <FormField id="member-name" label="Full name" value={form.fullName} onChange={set('fullName')} autoComplete="name" />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="member-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
        <FormField id="member-email" label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
      </div>
      <div className="space-y-2"><Label htmlFor="member-dob">Date of birth</Label><DatePicker id="member-dob" value={form.dateOfBirth} onChange={(d) => setForm({ ...form, dateOfBirth: d })} max={calendarDate()} shortcuts={false} placeholder="Not provided" /></div>
    </FormDialog>
  );
}

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasPermission } = useAuth();
  const [tab, setTab] = useState('overview');
  const [renewOpen, setRenewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const memberQuery = useMemberProfile(id);
  const timeline = useMemberTimeline(id, tab === 'timeline' && Boolean(memberQuery.data));
  const checkin = useMemberCheckin(id);
  const renewal = useMemberRenewal(id);
  if (!user) return null;

  if (memberQuery.isPending) return <><PageHeader title="Member profile" /><div role="status" aria-label="Loading member" className="space-y-3"><Skeleton className="h-10 w-60" /><Skeleton className="h-64 w-full" /></div></>;
  if (memberQuery.error) return <><PageHeader title="Member profile" />{'statusCode' in memberQuery.error && memberQuery.error.statusCode === 404 ? <EmptyState title="Member not found" description="This member is unavailable. Return to the members list to find another profile." action={<Link href="/members" className={buttonVariants({ variant: 'outline' })}>Back to members</Link>} /> : <PageError error={memberQuery.error} onRetry={() => { memberQuery.refetch(); }} />}</>;
  const member = memberQuery.data;
  if (!member) return null;
  const membership = member.membership;

  async function onCheckin() {
    try { await checkin.mutateAsync(); toast.success('Checked in'); }
    catch (error) { toast.error(getErrorMessage(error, "Couldn't check in. Please try again.")); }
  }
  async function onRenew() {
    try { await renewal.mutateAsync({ paymentMethod }); toast.success('Membership renewed'); setRenewOpen(false); }
    catch (error) { toast.error(getErrorMessage(error, "Couldn't renew the membership. Please try again.")); }
  }

  return (
    <div className="space-y-8">
      <EditMemberDialog key={`edit-${editOpen}`} member={member} open={editOpen} onClose={() => setEditOpen(false)} />
      <PageHeader title={member.fullName} description={member.memberCode} actions={hasPermission('members:read') && hasPermission('members:update') ? <><Button variant="outline" onClick={() => setEditOpen(true)}>Edit details</Button><Button onClick={onCheckin} disabled={checkin.isPending}>{checkin.isPending ? 'Checking in…' : 'Check in'}</Button></> : undefined} />
      {checkin.error && <Alert variant="destructive"><AlertDescription>{getErrorMessage(checkin.error, "Couldn't check in. Please try again.")}</AlertDescription></Alert>}
      {membership?.expiryState === 'EXPIRING_SOON' && <Alert className="text-warning"><AlertDescription>Membership expires in {membership.daysLeft} {membership.daysLeft === 1 ? 'day' : 'days'}.</AlertDescription></Alert>}
      {membership?.expiryState === 'EXPIRED' && <Alert variant="destructive"><AlertDescription>Membership expired on {formatDate(membership.endsOn)}. Renew to restore member benefits.</AlertDescription></Alert>}
      <div className="flex items-center gap-2">{membership && <Badge variant={membership.plan.code === 'GOLD' ? 'default' : membership.plan.code === 'SILVER' ? 'secondary' : 'outline'}>{membership.plan.name}</Badge>}<StatusBadge kind="membership" value={membership?.expiryState ?? 'NONE'} /></div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Member profile sections"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="timeline">Timeline</TabsTrigger><TabsTrigger value="membership">Membership</TabsTrigger></TabsList>
        <TabsContent value="overview">
          <dl className="divide-y text-sm">
            <Field label="Phone">{member.phone}</Field><Field label="Email">{member.email ?? 'Not provided'}</Field><Field label="Date of birth">{member.dateOfBirth ? formatDate(member.dateOfBirth) : 'Not provided'}</Field>
            <Field label="Plan">{membership?.plan.name ?? 'No membership'}</Field><Field label="Starts on">{membership ? formatDate(membership.startsOn) : '—'}</Field><Field label="Ends on">{membership ? formatDate(membership.endsOn) : '—'}</Field><Field label="Days left">{membership ? Math.max(0, membership.daysLeft) : '—'}</Field>
            <Field label="Court discount">{member.entitlements.courtDiscountPct}%</Field><Field label="Shop discount">{member.entitlements.shopDiscountPct}%</Field><Field label="Bar discount">{member.entitlements.barDiscountPct}%</Field><Field label="Daily bookings">{member.entitlements.maxBookingsPerDay}</Field><Field label="Booking horizon">{member.entitlements.bookingHorizonDays} days</Field>
          </dl>
        </TabsContent>
        <TabsContent value="timeline">
          {timeline.error ? <PageError error={timeline.error} onRetry={() => { timeline.refetch(); }} /> : timeline.isPending ? <div role="status" aria-label="Loading timeline" className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : timeline.data?.data.length === 0 ? <EmptyState title="No activity yet" description="Bookings, purchases and membership updates will appear here." /> : <ul className="divide-y">{timeline.data?.data.map((event, index) => <li key={`${event.type}-${event.at}-${index}`} className="flex flex-wrap items-start justify-between gap-4 py-4"><div className="space-y-1"><p className="font-medium">{event.title}</p>{event.detail && <p className="text-sm text-muted-foreground">{event.detail}</p>}<p className="text-xs text-muted-foreground">{formatDateTime(event.at)}</p></div>{event.amountPaise !== undefined && <Money paise={event.amountPaise} />}</li>)}</ul>}
        </TabsContent>
        <TabsContent value="membership" className="space-y-4">
          {membership ? <p className="text-sm text-muted-foreground">{membership.plan.name} membership ends on {formatDate(membership.endsOn)}.{membership.cancelAtPeriodEnd ? ' Cancellation is scheduled at the end of this term.' : ''}{membership.pendingPlan ? ` ${membership.pendingPlan.name} starts at renewal.` : ''}</p> : <EmptyState title="No membership" description="Register a membership to activate member benefits." />}
          {membership && hasPermission('memberships:update') && <Button variant="outline" onClick={() => { renewal.reset(); setPaymentMethod('CASH'); setRenewOpen(true); }}>Renew</Button>}
        </TabsContent>
      </Tabs>
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}><DialogContent><DialogHeader><DialogTitle>Renew membership</DialogTitle><DialogDescription>Record payment to renew {member.fullName}&apos;s {membership?.plan.name} membership.</DialogDescription></DialogHeader>
        <Label htmlFor="renew-payment">Payment method</Label><Select disabled={renewal.isPending} value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}><SelectTrigger id="renew-payment"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="CARD">Card</SelectItem><SelectItem value="UPI">UPI</SelectItem></SelectContent></Select>
        {renewal.error && <Alert variant="destructive"><AlertDescription>{getErrorMessage(renewal.error, "Couldn't renew. Please try again.")}</AlertDescription></Alert>}
        <Button disabled={renewal.isPending} onClick={onRenew}>{renewal.isPending ? 'Renewing…' : 'Confirm renewal'}</Button>
      </DialogContent></Dialog>
    </div>
  );
}
