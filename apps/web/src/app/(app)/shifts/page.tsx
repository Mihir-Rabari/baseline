'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Employee, Shift } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { qs } from '@/lib/ops';
import { mondayOf } from '@/lib/calendar-grid';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { DateField } from '@/components/club/date-field';
import { NoAccess, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Label } from '@/components/ui/label';
import { CardGrid, ViewSwitcher, WeekCalendar, useViewPreference, type ViewKind } from '@/components/club/views';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const variant: Record<string, BadgeProps['variant']> = { SCHEDULED: 'secondary', ON_SHIFT: 'success', DONE: 'outline', MISSED: 'destructive' };
const ROLE_LABELS = ['BAR', 'FRONT_DESK', 'KITCHEN', 'OTHER'];

function MyShift() {
  const current = useOpsQuery<Shift | null>(['shifts', 'current'], '/me/shift/current', { refetchMs: 15000 });
  const clockIn = useOpsMutation<Shift, { id: string }>('post', ['shifts', 'bar'], (v) => `/shifts/${v.id}/clock-in`);
  const clockOut = useOpsMutation<Shift, { id: string }>('post', ['shifts', 'bar'], (v) => `/shifts/${v.id}/clock-out`);
  const shift = current.data;
  async function run(action: () => Promise<unknown>, done: string) {
    try { await action(); toast.success(done); } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'That did not work.'); }
  }
  return (
    <section aria-label="My shift" className="space-y-3 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">My shift</h2>
      <QueryState query={current}>
        {!shift ? <p className="text-sm text-muted-foreground">You have no shift you can clock into right now.</p> : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm"><p className="font-medium">{humanize(shift.roleLabel)} · {formatDateTime(shift.startsAt)} to {formatDateTime(shift.endsAt)}</p>{shift.clockInAt && <p className="text-muted-foreground">Clocked in {formatDateTime(shift.clockInAt)}</p>}</div>
            <div className="flex items-center gap-2">
              <Badge variant={variant[shift.status]}>{humanize(shift.status)}</Badge>
              {shift.status === 'SCHEDULED' && <Button disabled={clockIn.isPending} onClick={() => { void run(() => clockIn.mutateAsync({ id: shift.id }), 'Clocked in'); }}>Clock in</Button>}
              {shift.status === 'ON_SHIFT' && <Button variant="outline" disabled={clockOut.isPending} onClick={() => { void run(() => clockOut.mutateAsync({ id: shift.id }), 'Clocked out'); }}>Clock out</Button>}
            </div>
          </div>
        )}
      </QueryState>
    </section>
  );
}

function ScheduleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const employees = useOpsQuery<Employee[]>(['hr', 'employees', 'active'], '/hr/employees?status=ACTIVE', { enabled: open });
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState('BAR');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Shift, { employeeId: string; roleLabel: string; startsAt: string; endsAt: string }>('post', ['shifts'], () => '/shifts');
  const chosen = employeeId || employees.data?.[0]?.id || '';
  async function submit() {
    setError(null);
    if (!starts || !ends) return setError('Choose a start and an end time.');
    const startsAt = new Date(starts); const endsAt = new Date(ends);
    if (!(endsAt > startsAt)) return setError('The shift must end after it starts.');
    try { await create.mutateAsync({ employeeId: chosen, roleLabel: role, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }); toast.success('Shift scheduled'); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not schedule the shift.'); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule a shift</DialogTitle><DialogDescription>Times are in your browser's time zone.</DialogDescription></DialogHeader>
        <SelectBox id="shift-employee" label="Employee" value={chosen} onChange={setEmployeeId} options={(employees.data ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${humanize(e.department)})` }))} />
        <SelectBox id="shift-role" label="Role" value={role} onChange={setRole} options={ROLE_LABELS.map((r) => ({ value: r, label: humanize(r) }))} />
        <div className="grid gap-4">
          <div className="space-y-2"><Label htmlFor="shift-start">Starts</Label><DateTimePicker id="shift-start" value={starts} onChange={setStarts} /></div>
          <div className="space-y-2"><Label htmlFor="shift-end">Ends</Label><DateTimePicker id="shift-end" value={ends} onChange={setEnds} /></div>
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending || !chosen} onClick={() => { void submit(); }}>Schedule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VIEWS: ViewKind[] = ['list', 'cards', 'calendar'];
const tone = (status: string) => (status === 'ON_SHIFT' ? 'success' : status === 'MISSED' ? 'warning' : status === 'DONE' ? 'muted' : 'default') as 'success' | 'warning' | 'muted' | 'default';

export default function ShiftsPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('shifts:read');
  const manage = hasPermission('shifts:manage');
  const today = calendarDate();
  const [from, setFrom] = useState(today);
  const [view, setView] = useViewPreference('shifts', VIEWS, 'list');
  const [scheduling, setScheduling] = useState(false);
  const rangeFrom = view === 'calendar' ? mondayOf(from) : from;
  const roster = useOpsQuery<Shift[]>(['shifts', 'roster', rangeFrom], `/shifts${qs({ from: rangeFrom, to: dateAfter(rangeFrom, 6) })}`, { enabled: allowed, refetchMs: 30000 });
  const remove = useOpsMutation<unknown, { id: string }>('delete', ['shifts'], (v) => `/shifts/${v.id}`);
  if (!user) return null;
  if (!allowed) return <NoAccess what="shifts" />;
  const rows = roster.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Shifts" description="Who is working when, for the seven days from the chosen date." actions={<><ViewSwitcher views={VIEWS} value={view} onChange={setView} />{manage && <Button onClick={() => setScheduling(true)}>Schedule shift</Button>}</>} />
      {hasPermission('shifts:clock:self') && <MyShift />}
      {view !== 'calendar' && <DateField value={from} min={dateAfter(today, -60)} max={dateAfter(today, 60)} onChange={setFrom} />}
      <QueryState query={{ ...roster, isEmpty: rows.length === 0 && view !== 'calendar' }} empty={{ title: 'No shifts in this week', description: manage ? 'Schedule a shift to fill the roster.' : 'You have no shifts scheduled.' }}>
        {view === 'calendar' ? (
          <WeekCalendar weekStart={from} onWeekChange={setFrom} emptyLabel="No shifts this week"
            events={rows.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, title: s.employee.fullName, subtitle: humanize(s.roleLabel), tone: tone(s.status) }))} />
        ) : view === 'cards' ? (
          <CardGrid>{rows.map((shift) => (
            <div key={shift.id} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-2"><p className="font-medium">{shift.employee.fullName}</p><Badge variant={variant[shift.status]}>{humanize(shift.status)}</Badge></div>
              <p className="text-muted-foreground">{humanize(shift.roleLabel)}</p>
              <p className="tabular">{formatDateTime(shift.startsAt)}<br />to {formatDateTime(shift.endsAt)}</p>
              {manage && shift.status === 'SCHEDULED' && <Button size="sm" variant="ghost" onClick={() => { void remove.mutateAsync({ id: shift.id }).then(() => toast.success('Shift deleted')).catch((e: Error) => toast.error(e.message)); }}>Delete</Button>}
            </div>
          ))}</CardGrid>
        ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead>Starts</TableHead><TableHead>Ends</TableHead><TableHead>Status</TableHead>{manage && <TableHead><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
          <TableBody>
            {rows.map((shift) => (
              <TableRow key={shift.id}>
                <TableCell className="font-medium">{shift.employee.fullName}</TableCell>
                <TableCell>{humanize(shift.roleLabel)}</TableCell>
                <TableCell className="tabular">{formatDateTime(shift.startsAt)}</TableCell>
                <TableCell className="tabular">{formatDateTime(shift.endsAt)}</TableCell>
                <TableCell><Badge variant={variant[shift.status]}>{humanize(shift.status)}</Badge></TableCell>
                {manage && <TableCell className="text-right">{shift.status === 'SCHEDULED' && <Button size="sm" variant="ghost" onClick={() => { void remove.mutateAsync({ id: shift.id }).then(() => toast.success('Shift deleted')).catch((e: Error) => toast.error(e.message)); }}>Delete</Button>}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </QueryState>
      <ScheduleDialog key={String(scheduling)} open={scheduling} onClose={() => setScheduling(false)} />
    </div>
  );
}
