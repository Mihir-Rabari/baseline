'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CreateShiftRequestSchema, type CreateShiftRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { hrApi } from '@/lib/hr-api';
import { clubToday } from '@/lib/mock-bar';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ViewSwitcher, WeekCalendar, useViewPreference, type ViewKind } from '@/components/club/views';
import { ShiftsCards } from '@/components/club/shifts-cards';
import { ShiftSwaps } from '@/components/club/shift-swaps';
import { dateAfter } from '@/lib/booking-calendar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { DropdownSelect } from '@/components/ui/dropdown-select';

const SHIFT_VIEWS: ViewKind[] = ['list', 'cards', 'calendar'];
const shiftTone = (status: string) => (status === 'ON_SHIFT' ? 'success' : status === 'MISSED' ? 'warning' : status === 'DONE' ? 'muted' : 'default') as 'success' | 'warning' | 'muted' | 'default';

export default function ShiftsPage() {
  const { user, hasPermission } = useAuth();
  const canRead = Boolean(user) && hasPermission('shifts:read');
  const canManage = hasPermission('shifts:manage');
  const canClock = Boolean(user) && hasPermission('shifts:clock:self');
  const client = useQueryClient();
  const [from, setFrom] = useState(clubToday);
  const [to, setTo] = useState(clubToday);
  const [dialog, setDialog] = useState(false);
  const [view, setView] = useViewPreference('shifts', SHIFT_VIEWS, 'list');
  const [formError, setFormError] = useState<string | null>(null);
  const validRange = Boolean(from && to && from <= to);
  const shifts = useQuery({ queryKey: ['shifts', user?.id, from, to], queryFn: () => hrApi.shifts({ from, to }, !canManage), enabled: canRead && validRange, refetchInterval: 15000, staleTime: 5000 });
  const current = useQuery({ queryKey: ['shifts', user?.id, 'current'], queryFn: hrApi.currentShift, enabled: canClock, refetchInterval: 15000, staleTime: 5000 });
  const employees = useQuery({ queryKey: ['hr', user?.id, 'employees'], queryFn: hrApi.employees, enabled: canManage && hasPermission('hr:read'), staleTime: 15000 });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['shifts'] }), client.invalidateQueries({ queryKey: ['hr'] }), client.invalidateQueries({ queryKey: ['dashboard'] })]); };
  const create = useMutation({ mutationFn: (data: CreateShiftRequest) => hrApi.createShift(data), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => hrApi.deleteShift(id), onSettled: refresh });
  const clock = useMutation({ mutationFn: ({ id, out }: { id: string; out: boolean }) => out ? hrApi.clockOut(id) : hrApi.clockIn(id), onSettled: refresh });
  const pending = create.isPending || remove.isPending || clock.isPending;
  if (!user) return null;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canManage || pending) return;
    const form = new FormData(event.currentTarget); setFormError(null);
    const instant = (value: FormDataEntryValue | null) => {
      const parsed = new Date(`${value}:00+05:30`); return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
    };
    const data = CreateShiftRequestSchema.safeParse({ employeeId: form.get('employeeId'), roleLabel: form.get('roleLabel'), startsAt: instant(form.get('startsAt')), endsAt: instant(form.get('endsAt')) });
    if (!data.success) { setFormError(data.error.issues[0].message); return; }
    try { await create.mutateAsync(data.data); setDialog(false); } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not schedule shift.'); }
  };
  return <div className="space-y-8"><PageHeader title="Shifts" description="Review the roster and clock your current shift." actions={<><ViewSwitcher views={SHIFT_VIEWS} value={view} onChange={setView} />{canManage && <Button disabled={pending} onClick={() => { setFormError(null); setDialog(true); }}>Schedule shift</Button>}</>} />
    {!canRead ? <EmptyState title="Shift access required" description="Ask the owner for access to your shifts." /> : <>
      <div className="flex flex-wrap gap-4"><div className="space-y-2"><Label htmlFor="shifts-from">From</Label><DatePicker id="shifts-from" className="w-56" value={from} onChange={(value) => { if (value) setFrom(value); }} /></div><div className="space-y-2"><Label htmlFor="shifts-to">To</Label><DatePicker id="shifts-to" className="w-56" value={to} min={from} onChange={(value) => { if (value) setTo(value); }} /></div></div>
      {!validRange && <p role="alert" className="text-sm text-destructive">Choose an end date on or after the start date.</p>}
      {canClock && <section className="space-y-3 rounded-lg border p-4"><h2 className="text-lg font-semibold">Current shift</h2>{current.isPending ? <Skeleton className="h-12" /> : current.isError ? <PageError error={current.error} onRetry={() => current.refetch()} /> : current.data ? <div className="flex flex-wrap items-center justify-between gap-3"><p>{current.data.roleLabel.replaceAll('_', ' ')} · {formatDateTime(current.data.startsAt)} – {formatDateTime(current.data.endsAt)}</p><Button disabled={pending} onClick={() => { if (!pending) clock.mutate({ id: current.data!.id, out: Boolean(current.data!.clockInAt) }); }}>{clock.isPending ? 'Updating…' : current.data.clockInAt ? 'Clock out' : 'Clock in'}</Button></div> : <p className="text-sm text-muted-foreground">No current shift. Ask the owner to check your schedule.</p>}</section>}
      <ShiftSwaps />
      {(remove.isError || clock.isError) && <p role="alert" className="text-sm text-destructive">{remove.error?.message ?? clock.error?.message}</p>}
      {validRange && (shifts.isPending ? <Skeleton className="h-64" /> : shifts.isError ? <PageError error={shifts.error} onRetry={() => shifts.refetch()} /> : !shifts.data?.length ? <EmptyState title="No shifts in this range" description="Choose other dates or ask the owner to schedule a shift." /> : view === 'calendar' ? <WeekCalendar weekStart={from} onWeekChange={(monday) => { setFrom(monday); setTo(dateAfter(monday, 6)); }} emptyLabel="No shifts this week" events={shifts.data.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, title: s.employee.fullName, subtitle: s.roleLabel.replaceAll('_', ' ').toLowerCase(), tone: shiftTone(s.status) }))} /> : view === 'cards' ? <ShiftsCards shifts={shifts.data} canManage={canManage} disabled={pending} onRemove={(id) => { if (!pending) remove.mutate(id); }} /> : <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead>Shift (IST)</TableHead><TableHead>Status</TableHead>{canManage && <TableHead>Actions</TableHead>}</TableRow></TableHeader><TableBody>{shifts.data.map((row) => <TableRow key={row.id}><TableCell>{row.employee.fullName}</TableCell><TableCell>{row.roleLabel.replaceAll('_', ' ')}</TableCell><TableCell>{formatDateTime(row.startsAt)} – {formatDateTime(row.endsAt)}</TableCell><TableCell><Badge variant={row.status === 'ON_SHIFT' ? 'success' : row.status === 'MISSED' ? 'warning' : 'outline'}>{row.status.replaceAll('_', ' ').toLowerCase()}</Badge></TableCell>{canManage && <TableCell>{!row.clockInAt && <Button variant="ghost" size="sm" disabled={pending} onClick={() => { if (!pending) remove.mutate(row.id); }}>Remove</Button>}</TableCell>}</TableRow>)}</TableBody></Table>)}
    </>}
    <Dialog open={dialog} onOpenChange={(open) => { if (!pending) setDialog(open); }}><DialogContent><DialogHeader><DialogTitle>Schedule shift</DialogTitle><DialogDescription>Enter the start and end in club time (IST).</DialogDescription></DialogHeader>
      {employees.isPending ? <Skeleton className="h-48" /> : employees.isError ? <PageError error={employees.error} onRetry={() => employees.refetch()} /> : !employees.data?.some((row) => row.status === 'ACTIVE') ? <EmptyState title="No active employees" description="Add an employee before scheduling shifts." /> : <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-2"><Label htmlFor="shift-employee">Employee</Label><DropdownSelect id="shift-employee" name="employeeId" disabled={pending} defaultValue={employees.data.filter((row) => row.status === 'ACTIVE')[0]?.id} options={employees.data.filter((row) => row.status === 'ACTIVE').map((row) => ({ value: row.id, label: row.fullName }))} /></div>
        <div className="space-y-2"><Label htmlFor="shift-role">Role</Label><DropdownSelect id="shift-role" name="roleLabel" disabled={pending} defaultValue="FRONT_DESK" options={['FRONT_DESK', 'BAR', 'KITCHEN', 'OTHER'].map((role) => ({ value: role, label: role.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} /></div>
        <div className="space-y-2"><Label htmlFor="shift-start">Start (IST)</Label><DateTimePicker id="shift-start" name="startsAt" disabled={pending} /></div><div className="space-y-2"><Label htmlFor="shift-end">End (IST)</Label><DateTimePicker id="shift-end" name="endsAt" disabled={pending} /></div>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<Button type="submit" disabled={pending || !canManage}>{pending ? 'Scheduling…' : 'Schedule shift'}</Button>
      </form>}
    </DialogContent></Dialog>
  </div>;
}
