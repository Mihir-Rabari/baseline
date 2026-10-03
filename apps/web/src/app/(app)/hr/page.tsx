'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Employee, LeaveRequest, PayrollSummary } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { qs, type Page } from '@/lib/ops';
import { calendarDate } from '@/lib/booking-calendar';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
import { NoAccess, Pager, QueryState, SelectBox, Stat, humanize } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { MonthField } from '@/components/ui/month-field';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const leaveVariant: Record<string, BadgeProps['variant']> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'destructive', CANCELLED: 'outline' };
const day = (date: string) => formatDate(`${date}T12:00:00+05:30`);

function LeaveTable({ rows, decide }: { rows: LeaveRequest[]; decide?: (leave: LeaveRequest, decision: 'APPROVED' | 'REJECTED') => void }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Days</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead>{decide && <TableHead><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
      <TableBody>
        {rows.map((leave) => (
          <TableRow key={leave.id}>
            <TableCell className="font-medium">{leave.employee.fullName}</TableCell>
            <TableCell>{humanize(leave.leaveType)}</TableCell>
            <TableCell className="tabular">{day(leave.fromDate)}{leave.toDate !== leave.fromDate && ` – ${day(leave.toDate)}`}</TableCell>
            <TableCell className="text-right tabular">{leave.days}</TableCell>
            <TableCell className="max-w-48 truncate text-sm">{leave.reason ?? '—'}{leave.decisionNote && <div className="text-xs text-muted-foreground">{leave.decisionNote}</div>}</TableCell>
            <TableCell><Badge variant={leaveVariant[leave.status]}>{humanize(leave.status)}</Badge></TableCell>
            {decide && <TableCell className="space-x-2 text-right">{leave.status === 'PENDING' && <><Button size="sm" onClick={() => decide(leave, 'APPROVED')}>Approve</Button><Button size="sm" variant="outline" onClick={() => decide(leave, 'REJECTED')}>Reject</Button></>}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const DEPARTMENTS = ['FRONT_DESK', 'BAR', 'MAINTENANCE', 'COACHING', 'MANAGEMENT'];

function EmployeeDialog({ employee, open, onClose }: { employee: Employee | null; open: boolean; onClose: () => void }) {
  const editing = Boolean(employee);
  const [form, setForm] = useState({
    fullName: employee?.fullName ?? '', position: employee?.position ?? '', department: employee?.department ?? 'FRONT_DESK',
    salary: employee ? fromPaise(employee.monthlySalaryPaise) : '', hiredOn: employee?.hiredOn ?? calendarDate(), email: '', phone: '', status: employee?.status ?? 'ACTIVE',
  });
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Employee, object>('post', ['hr', 'shifts', 'reports'], () => '/hr/employees');
  const update = useOpsMutation<Employee, { id: string; [key: string]: unknown }>('put', ['hr', 'shifts', 'reports'], (v) => `/hr/employees/${v.id}`);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit() {
    setError(null);
    const monthlySalaryPaise = toPaise(form.salary);
    if (!form.fullName.trim()) return setError('Enter the employee\'s name.');
    if (!form.position.trim()) return setError('Enter a position, for example Bartender.');
    if (!Number.isFinite(monthlySalaryPaise)) return setError('Enter the monthly salary in rupees.');
    try {
      const base = { fullName: form.fullName.trim(), position: form.position.trim(), department: form.department, monthlySalaryPaise, hiredOn: form.hiredOn, ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) };
      if (employee) await update.mutateAsync({ id: employee.id, ...base, status: form.status });
      else await create.mutateAsync(base);
      toast.success(editing ? `${form.fullName.trim()} updated` : `${form.fullName.trim()} added`);
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the employee.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={editing ? `Edit ${employee?.fullName}` : 'New employee'} description={editing ? 'Leave email and phone blank to keep what is on file.' : 'Add someone to the staff list. Link a login later so they can clock in.'} onSubmit={submit} submitLabel={editing ? 'Save changes' : 'Add employee'} pending={create.isPending || update.isPending} error={error}>
      <Field id="emp-name" label="Full name" value={form.fullName} onChange={set('fullName')} autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="emp-position" label="Position" value={form.position} onChange={set('position')} />
        <SelectBox id="emp-department" label="Department" value={form.department} onChange={(value) => setForm({ ...form, department: value as typeof form.department })} options={DEPARTMENTS.map((d) => ({ value: d, label: humanize(d) }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="emp-salary" label="Monthly salary (₹)" inputMode="decimal" value={form.salary} onChange={set('salary')} />
        <div className="space-y-2"><Label htmlFor="emp-hired">Hired on</Label><DatePicker id="emp-hired" value={form.hiredOn} onChange={(d) => setForm({ ...form, hiredOn: d })} shortcuts={false} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="emp-email" label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="off" />
        <Field id="emp-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="off" />
      </div>
      {editing && <SelectBox id="emp-status" label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value as typeof form.status })} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive (left the club)' }]} />}
    </FormDialog>
  );
}

function Employees({ canManage }: { canManage: boolean }) {
  const [department, setDepartment] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const query = useOpsQuery<Employee[]>(['hr', 'employees', department], `/hr/employees${qs({ department })}`);
  const rows = query.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
      <SelectBox id="hr-dept" label="Department" className="w-56" value={department} onChange={setDepartment} options={[{ value: '', label: 'All departments' }, ...DEPARTMENTS.map((d) => ({ value: d, label: humanize(d) }))]} />
      {canManage && <Button onClick={() => setCreating(true)}>New employee</Button>}
      </div>
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No employees', description: 'Nobody matches that department.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Position</TableHead><TableHead>Department</TableHead><TableHead className="text-right">Monthly salary</TableHead><TableHead>Hired</TableHead><TableHead className="text-right">Leave this year</TableHead><TableHead>Status</TableHead>{canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
          <TableBody>{rows.map((e) => <TableRow key={e.id}><TableCell className="font-medium">{e.fullName}</TableCell><TableCell>{e.position}</TableCell><TableCell>{humanize(e.department)}</TableCell><TableCell className="text-right"><Money paise={e.monthlySalaryPaise} /></TableCell><TableCell className="tabular">{day(e.hiredOn)}</TableCell><TableCell className="text-right tabular">{e.leaveDaysThisYear} days</TableCell><TableCell><Badge variant={e.status === 'ACTIVE' ? 'success' : 'outline'}>{humanize(e.status)}</Badge></TableCell>{canManage && <TableCell className="text-right"><Button size="sm" variant="outline" aria-label={`Edit ${e.fullName}`} onClick={() => setEditing(e)}>Edit</Button></TableCell>}</TableRow>)}</TableBody>
        </Table>
      </QueryState>
      <EmployeeDialog key={`n-${creating}`} employee={null} open={creating} onClose={() => setCreating(false)} />
      <EmployeeDialog key={`e-${editing?.id ?? 'none'}`} employee={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
    </div>
  );
}

function AllLeave() {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const query = useOpsQuery<Page<LeaveRequest>>(['hr', 'leave', status, page], `/hr/leave${qs({ status, page, limit: 20 })}`);
  const decide = useOpsMutation<LeaveRequest, { id: string; decision: string; note?: string }>('post', ['hr'], (v) => `/hr/leave/${v.id}/decision`);
  const rows = query.data?.data ?? [];
  function onDecide(leave: LeaveRequest, decision: 'APPROVED' | 'REJECTED') {
    const note = decision === 'REJECTED' ? window.prompt('Reason for rejecting (shown to the employee)') ?? '' : '';
    if (decision === 'REJECTED' && !note.trim()) return;
    void decide.mutateAsync({ id: leave.id, decision, ...(note.trim() ? { note: note.trim() } : {}) }).then(() => toast.success(`Leave ${decision.toLowerCase()}`)).catch((e: Error) => toast.error(e.message));
  }
  return (
    <div className="space-y-4">
      <SelectBox id="hr-leave-status" label="Show" className="max-w-xs" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All requests' }, ...['PENDING', 'APPROVED', 'REJECTED'].map((s) => ({ value: s, label: humanize(s) }))]} />
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No leave requests', description: 'Requests from staff appear here for a decision.' }}>
        <LeaveTable rows={rows} decide={onDecide} />
        <Pager meta={query.data?.meta} onPage={setPage} />
      </QueryState>
    </div>
  );
}

function RequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = calendarDate();
  const [form, setForm] = useState({ leaveType: 'CASUAL', fromDate: today, toDate: today, reason: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<LeaveRequest, object>('post', ['hr'], () => '/me/leave');
  async function submit() {
    setError(null);
    if (form.toDate < form.fromDate) return setError('The last day cannot be before the first day.');
    try { await create.mutateAsync({ leaveType: form.leaveType, fromDate: form.fromDate, toDate: form.toDate, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) }); toast.success('Leave requested'); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not request leave.'); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request leave</DialogTitle><DialogDescription>The owner is notified and will approve or reject it.</DialogDescription></DialogHeader>
        <SelectBox id="leave-type" label="Type" value={form.leaveType} onChange={(v) => setForm({ ...form, leaveType: v })} options={['CASUAL', 'SICK', 'PAID'].map((t) => ({ value: t, label: humanize(t) }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="leave-from">From</Label><DatePicker id="leave-from" value={form.fromDate} onChange={(d) => setForm({ ...form, fromDate: d, toDate: form.toDate < d ? d : form.toDate })} /></div>
          <div className="space-y-2"><Label htmlFor="leave-to">To</Label><DatePicker id="leave-to" value={form.toDate} min={form.fromDate} onChange={(d) => setForm({ ...form, toDate: d })} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="leave-reason">Reason (optional)</Label><Input id="leave-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending} onClick={() => { void submit(); }}>Request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MyLeave() {
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState(false);
  const query = useOpsQuery<Page<LeaveRequest>>(['hr', 'my-leave', page], `/me/leave${qs({ page, limit: 20 })}`);
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-4">
      <Button onClick={() => setAsking(true)}>Request leave</Button>
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No leave requests yet', description: 'Request leave and its status shows here.' }}>
        <LeaveTable rows={rows} /><Pager meta={query.data?.meta} onPage={setPage} />
      </QueryState>
      <RequestDialog key={String(asking)} open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}

function Payroll() {
  const [month, setMonth] = useState(calendarDate().slice(0, 7));
  const query = useOpsQuery<PayrollSummary>(['hr', 'payroll', month], `/hr/payroll-summary${qs({ month })}`, { enabled: /^\d{4}-\d{2}$/.test(month) });
  const data = query.data;
  return (
    <div className="space-y-4">
      <MonthField id="payroll-month" value={month} onChange={setMonth} />
      <QueryState query={query}>
        {data && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3"><Stat label="Payroll for the month" value={<Money paise={data.totalPaise} />} /><Stat label="Headcount" value={data.headcount} /><Stat label="On leave" value={data.onLeave.length} /></div>
          <Table>
            <TableHeader><TableRow><TableHead>Department</TableHead><TableHead className="text-right">Headcount</TableHead><TableHead className="text-right">Salaries</TableHead></TableRow></TableHeader>
            <TableBody>{data.byDepartment.map((d) => <TableRow key={d.department}><TableCell>{humanize(d.department)}</TableCell><TableCell className="text-right tabular">{d.headcount}</TableCell><TableCell className="text-right"><Money paise={d.amountPaise} /></TableCell></TableRow>)}</TableBody>
          </Table>
          {data.onLeave.length > 0 && <ul className="text-sm text-muted-foreground">{data.onLeave.map((l, i) => <li key={i}>{l.employeeName} on leave {day(l.fromDate)} – {day(l.toDate)}</li>)}</ul>}
        </div>}
      </QueryState>
    </div>
  );
}

export default function HrPage() {
  const { user, hasPermission } = useAuth();
  const tabs = [
    hasPermission('hr:read') && { value: 'employees', label: 'Employees' },
    hasPermission('leave:read') && { value: 'leave', label: 'Leave requests' },
    hasPermission('leave:read:self') && { value: 'mine', label: 'My leave' },
    hasPermission('hr:read') && { value: 'payroll', label: 'Payroll' },
  ].filter(Boolean) as Array<{ value: string; label: string }>;
  const [tab, setTab] = useState('');
  if (!user) return null;
  if (tabs.length === 0) return <NoAccess what="staff and leave" />;
  const active = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  return (
    <div className="space-y-6">
      <PageHeader title="Staff and leave" description="Employees, leave requests and monthly payroll." />
      <Tabs value={active} onValueChange={setTab}><TabsList aria-label="Section">{tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList></Tabs>
      {active === 'employees' && <Employees canManage={hasPermission('hr:manage')} />}
      {active === 'leave' && <AllLeave />}
      {active === 'mine' && <MyLeave />}
      {active === 'payroll' && <Payroll />}
    </div>
  );
}
