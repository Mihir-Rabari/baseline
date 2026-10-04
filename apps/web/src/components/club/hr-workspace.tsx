'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Employee, LeaveStatus, CreateEmployeeRequest, CreateLeaveRequest, LeaveDecisionRequest } from '@packages/validation';
import { CreateEmployeeRequestSchema, CreateLeaveRequestSchema } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { hrApi } from '@/lib/hr-api';
import { clubToday } from '@/lib/mock-bar';
import { Money } from '@/components/club/money';
import { StatTile } from '@/components/club/stat-tile';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { DropdownSelect } from '@/components/ui/dropdown-select';
import { LeaveBoard, LeaveCards } from '@/components/club/leave-views';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';

const LEAVE_VIEWS: ViewKind[] = ['list', 'cards', 'board'];

export function HrWorkspace() {
  const { user, hasPermission } = useAuth();
  const client = useQueryClient();
  const canHr = Boolean(user) && hasPermission('hr:read');
  const canManage = hasPermission('hr:manage');
  const canLeave = canHr || hasPermission('leave:read:self');
  const canDecide = hasPermission('leave:decide');
  const canRequest = hasPermission('leave:create:self');
  const [page, setPage] = useState(1);
  const [leaveView, setLeaveView] = useViewPreference('leave', LEAVE_VIEWS, 'list');
  const [leaveStatus, setLeaveStatus] = useState<LeaveStatus | undefined>();
  const [month, setMonth] = useState(clubToday().slice(0, 7));
  const [employeeDialog, setEmployeeDialog] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const employees = useQuery({ queryKey: ['hr', user?.id, 'employees'], queryFn: hrApi.employees, enabled: canHr, staleTime: 15000 });
  const leave = useQuery({ queryKey: ['hr', user?.id, 'leave', page, leaveStatus], queryFn: () => hrApi.leave(page, !canHr, canHr ? leaveStatus : undefined), enabled: Boolean(user) && canLeave, staleTime: 10000 });
  const payroll = useQuery({ queryKey: ['hr', user?.id, 'payroll', month], queryFn: () => hrApi.payroll(month), enabled: canHr, staleTime: 15000 });
  const refresh = () => client.invalidateQueries({ queryKey: ['hr'] });
  const saveEmployee = useMutation({ mutationFn: (data: CreateEmployeeRequest & { status?: "ACTIVE" | "INACTIVE" }) => editing ? hrApi.updateEmployee(editing.id, data) : hrApi.createEmployee(data), onSuccess: refresh });
  const request = useMutation({ mutationFn: (data: CreateLeaveRequest) => hrApi.requestLeave(data), onSuccess: refresh });
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: LeaveDecisionRequest['decision'] }) => hrApi.decide(id, { decision }), onSettled: refresh });
  const employeeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canManage || saveEmployee.isPending) return;
    const form = new FormData(event.currentTarget); setFormError(null);
    const data = CreateEmployeeRequestSchema.safeParse({ fullName: form.get('fullName'), position: form.get('position'), department: form.get('department'),
      monthlySalaryPaise: Math.round(Number(form.get('salary')) * 100), hiredOn: form.get('hiredOn') });
    if (!data.success) { setFormError(data.error.issues[0].message); return; }
    try { await saveEmployee.mutateAsync({ ...data.data, ...(editing ? { status: String(form.get('status')) as 'ACTIVE' | 'INACTIVE' } : {}) }); setEmployeeDialog(false); } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not save employee.'); }
  };
  const leaveSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canRequest || request.isPending) return;
    const form = new FormData(event.currentTarget); setFormError(null);
    const data = CreateLeaveRequestSchema.safeParse({ leaveType: form.get('leaveType'), fromDate: form.get('fromDate'), toDate: form.get('toDate'), reason: form.get('reason') });
    if (!data.success) { setFormError(data.error.issues[0].message); return; }
    try { await request.mutateAsync(data.data); setLeaveDialog(false); } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not request leave.'); }
  };
  if (!canHr && !canLeave) return <EmptyState title="Staff access required" description="Ask the owner for access to staff and leave records." />;
  return <>
    <Tabs defaultValue={canHr ? 'employees' : 'leave'}><TabsList>{canHr && <TabsTrigger value="employees">Employees</TabsTrigger>}<TabsTrigger value="leave">{canHr ? 'Leave' : 'My leave'}</TabsTrigger>{canHr && <TabsTrigger value="payroll">Payroll</TabsTrigger>}</TabsList>
      {canHr && <TabsContent value="employees" className="space-y-4">
        {canManage && <Button onClick={() => { setEditing(null); setFormError(null); setEmployeeDialog(true); }}>Add employee</Button>}
        {employees.isPending ? <Skeleton className="h-64" /> : employees.isError ? <PageError error={employees.error} onRetry={() => employees.refetch()} /> : !employees.data?.length ? <EmptyState title="No employees" description="Add employees to plan shifts and payroll." /> :
          <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Position</TableHead><TableHead>Department</TableHead><TableHead>Monthly salary</TableHead><TableHead>Status</TableHead>{canManage && <TableHead>Actions</TableHead>}</TableRow></TableHeader><TableBody>{employees.data.map((row) => <TableRow key={row.id}><TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/hr/employees/${row.id}`}>{row.fullName}</Link></TableCell><TableCell>{row.position}</TableCell><TableCell>{row.department.replaceAll('_', ' ')}</TableCell><TableCell><Money paise={row.monthlySalaryPaise} /></TableCell><TableCell><Badge variant={row.status === 'ACTIVE' ? 'success' : 'outline'}>{row.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></TableCell>{canManage && <TableCell><Button variant="outline" size="sm" onClick={() => { setEditing(row); setFormError(null); setEmployeeDialog(true); }}>Edit</Button></TableCell>}</TableRow>)}</TableBody></Table>}
      </TabsContent>}
      <TabsContent value="leave" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            {canRequest && <Button onClick={() => { setFormError(null); setLeaveDialog(true); }}>Request leave</Button>}
            {canHr && <div className="space-y-2"><Label htmlFor="leave-filter">Status</Label><DropdownSelect id="leave-filter" className="w-44" value={leaveStatus ?? ''} onValueChange={(value) => { setLeaveStatus((value || undefined) as LeaveStatus | undefined); setPage(1); }} options={[{ value: '', label: 'All statuses' }, ...['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((value) => ({ value, label: value.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))]} /></div>}
          </div>
          <ViewSwitcher views={LEAVE_VIEWS} value={leaveView} onChange={setLeaveView} />
        </div>
        {decide.error && <p role="alert" className="text-sm text-destructive">{decide.error.message}</p>}
        {leave.isPending ? <Skeleton className="h-64" /> : leave.isError ? <PageError error={leave.error} onRetry={() => leave.refetch()} /> : !leave.data?.data.length ? <EmptyState title="No leave requests" description="Requests matching this filter will appear here." /> :
          leaveView === 'board' ? (
            <LeaveBoard requests={leave.data.data} canDecide={canDecide} disabled={decide.isPending} onDecide={(id, decision) => decide.mutate({ id, decision })} />
          ) : leaveView === 'cards' ? (
            <>
              <LeaveCards requests={leave.data.data} canDecide={canDecide} disabled={decide.isPending} onDecide={(id, decision) => decide.mutate({ id, decision })} />
              {leave.data && leave.data.meta.totalPages > 1 && <div className="flex items-center justify-between pt-2"><Button variant="outline" disabled={!leave.data.meta.hasPrevPage} onClick={() => setPage((value) => value - 1)}>Previous</Button><p className="text-sm">Page {page} of {leave.data.meta.totalPages}</p><Button variant="outline" disabled={!leave.data.meta.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
            </>
          ) : (
            <>
              <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Dates</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead>{canDecide && <TableHead>Decision</TableHead>}</TableRow></TableHeader><TableBody>{leave.data.data.map((row) => <TableRow key={row.id}><TableCell>{row.employee.fullName}</TableCell><TableCell className="whitespace-nowrap">{row.fromDate} – {row.toDate}<p className="text-sm text-muted-foreground">{row.days} days · {row.leaveType.toLowerCase()}</p></TableCell><TableCell>{row.reason ?? 'No reason provided'}</TableCell><TableCell><Badge variant={row.status === 'APPROVED' ? 'success' : row.status === 'PENDING' ? 'warning' : 'outline'}>{row.status.toLowerCase()}</Badge></TableCell>{canDecide && <TableCell>{row.status === 'PENDING' && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, decision: 'APPROVED' })}>Approve</Button><Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, decision: 'REJECTED' })}>Reject</Button></div>}</TableCell>}</TableRow>)}</TableBody></Table>
              {leave.data && leave.data.meta.totalPages > 1 && <div className="flex items-center justify-between"><Button variant="outline" disabled={!leave.data.meta.hasPrevPage} onClick={() => setPage((value) => value - 1)}>Previous</Button><p className="text-sm">Page {page} of {leave.data.meta.totalPages}</p><Button variant="outline" disabled={!leave.data.meta.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
            </>
          )}
      </TabsContent>
      {canHr && <TabsContent value="payroll" className="space-y-4">{canManage && <Button asChild><Link href="/hr/payroll">Run payroll and payslips</Link></Button>}<div className="space-y-2"><Label htmlFor="payroll-month">Month</Label><Input id="payroll-month" type="month" className="w-fit" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></div>
        {payroll.isPending ? <Skeleton className="h-64" /> : payroll.isError ? <PageError error={payroll.error} onRetry={() => payroll.refetch()} /> : payroll.data && <><div className="grid gap-4 sm:grid-cols-2"><StatTile label="Payroll due" value={<Money paise={payroll.data.totalPaise} />} /><StatTile label="Employees" value={payroll.data.headcount} /></div>{!payroll.data.headcount ? <EmptyState title="No active employees" description="Add employees to calculate payroll." /> : <Table><TableHeader><TableRow><TableHead>Department</TableHead><TableHead>Employees</TableHead><TableHead>Salary due</TableHead></TableRow></TableHeader><TableBody>{payroll.data.byDepartment.map((row) => <TableRow key={row.department}><TableCell>{row.department.replaceAll('_', ' ')}</TableCell><TableCell className="tabular">{row.headcount}</TableCell><TableCell><Money paise={row.amountPaise} /></TableCell></TableRow>)}</TableBody></Table>}<h2 className="text-lg font-semibold">Approved leave this month</h2>{!payroll.data.onLeave.length ? <p className="text-sm text-muted-foreground">No approved leave.</p> : <ul className="divide-y">{payroll.data.onLeave.map((row, index) => <li key={index} className="py-3">{row.employeeName} · {row.fromDate} – {row.toDate}</li>)}</ul>}</>}
      </TabsContent>}
    </Tabs>
    <Dialog open={employeeDialog} onOpenChange={(open) => { if (!saveEmployee.isPending) setEmployeeDialog(open); }}><DialogContent><DialogHeader><DialogTitle>{editing ? 'Edit employee' : 'Add employee'}</DialogTitle><DialogDescription>Record their role and monthly salary.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={employeeSubmit}>
      <div className="space-y-2"><Label htmlFor="employee-name">Full name</Label><Input id="employee-name" name="fullName" defaultValue={editing?.fullName} required maxLength={200} disabled={saveEmployee.isPending} /></div>
      <div className="space-y-2"><Label htmlFor="employee-position">Position</Label><Input id="employee-position" name="position" defaultValue={editing?.position} required disabled={saveEmployee.isPending} /></div>
      <div className="space-y-2"><Label htmlFor="employee-department">Department</Label><DropdownSelect id="employee-department" name="department" defaultValue={editing?.department ?? 'FRONT_DESK'} disabled={saveEmployee.isPending} options={['FRONT_DESK', 'BAR', 'COACHING', 'MANAGEMENT', 'MAINTENANCE'].map((value) => ({ value, label: value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} /></div>
      <div className="space-y-2"><Label htmlFor="employee-salary">Monthly salary (₹)</Label><Input id="employee-salary" name="salary" type="number" min="0" step="0.01" defaultValue={editing ? editing.monthlySalaryPaise / 100 : ''} required disabled={saveEmployee.isPending} /></div>
      <div className="space-y-2"><Label htmlFor="employee-hired">Hired on</Label><DatePicker id="employee-hired" name="hiredOn" defaultValue={editing?.hiredOn ?? clubToday()} disabled={saveEmployee.isPending} shortcuts={false} /></div>
      {editing && <div className="space-y-2"><Label htmlFor="employee-status">Status</Label><DropdownSelect id="employee-status" name="status" defaultValue={editing.status} disabled={saveEmployee.isPending} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} /></div>}
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<Button type="submit" className="w-full" disabled={!canManage || saveEmployee.isPending}>{saveEmployee.isPending ? 'Saving…' : 'Save employee'}</Button>
    </form></DialogContent></Dialog>
    <Dialog open={leaveDialog} onOpenChange={(open) => { if (!request.isPending) setLeaveDialog(open); }}><DialogContent><DialogHeader><DialogTitle>Request leave</DialogTitle><DialogDescription>The owner will review your request.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={leaveSubmit}>
      <div className="space-y-2"><Label htmlFor="leave-type">Leave type</Label><DropdownSelect id="leave-type" name="leaveType" defaultValue="CASUAL" disabled={request.isPending} options={['CASUAL', 'SICK', 'PAID'].map((value) => ({ value, label: value.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} /></div>
      <div className="space-y-2"><Label htmlFor="leave-from">From</Label><DatePicker id="leave-from" name="fromDate" defaultValue={clubToday()} disabled={request.isPending} /></div><div className="space-y-2"><Label htmlFor="leave-to">To</Label><DatePicker id="leave-to" name="toDate" defaultValue={clubToday()} disabled={request.isPending} /></div>
      <div className="space-y-2"><Label htmlFor="leave-reason">Reason</Label><Input id="leave-reason" name="reason" maxLength={1000} disabled={request.isPending} /></div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<Button className="w-full" type="submit" disabled={!canRequest || request.isPending}>{request.isPending ? 'Requesting…' : 'Request leave'}</Button>
    </form></DialogContent></Dialog>
  </>;
}
