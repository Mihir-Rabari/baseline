'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { BankDetails, Payslip, PayrollRun, PayrollRunDetail } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { API_BASE_URL } from '@/lib/api-client';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
import { NoAccess, QueryState, humanize } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEYS = ['payroll'];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const STATUS_VARIANT = { DRAFT: 'outline', FINALIZED: 'warning', PAID: 'success' } as const;

function SlipDialog({ slip, open, onClose }: { slip: Payslip; open: boolean; onClose: () => void }) {
  const [leave, setLeave] = useState(String(slip.unpaidLeaveDays));
  const [bonus, setBonus] = useState(fromPaise(slip.bonusPaise));
  const [deduction, setDeduction] = useState(fromPaise(slip.otherDeductionPaise));
  const [note, setNote] = useState(slip.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<Payslip, { id: string; [key: string]: unknown }>('put', KEYS, (v) => `/hr/payroll/slips/${v.id}`);
  async function submit() {
    setError(null);
    const unpaidLeaveDays = Number(leave);
    const bonusPaise = toPaise(bonus);
    const otherDeductionPaise = toPaise(deduction);
    if (!Number.isInteger(unpaidLeaveDays) || unpaidLeaveDays < 0 || unpaidLeaveDays > slip.payableDays) return setError(`Unpaid leave must be a whole number from 0 to ${slip.payableDays}.`);
    if (!Number.isFinite(bonusPaise) || bonusPaise < 0) return setError('Enter the bonus in rupees (0 for none).');
    if (!Number.isFinite(otherDeductionPaise) || otherDeductionPaise < 0) return setError('Enter the deduction in rupees (0 for none).');
    try {
      await save.mutateAsync({ id: slip.id, unpaidLeaveDays, bonusPaise, otherDeductionPaise, note: note.trim() || null });
      toast.success(`${slip.employeeName} updated`);
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the payslip.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={`Adjust ${slip.employeeName}`} description={`${slip.approvedLeaveDays} days of approved leave and ${slip.shiftsWorked} of ${slip.shiftsScheduled} shifts worked this month. Unpaid days are deducted from the monthly salary.`} onSubmit={submit} submitLabel="Save payslip" pending={save.isPending} error={error}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="slip-leave" label="Unpaid leave days" inputMode="numeric" value={leave} onChange={(e) => setLeave(e.target.value)} />
        <Field id="slip-bonus" label="Bonus (₹)" inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} />
        <Field id="slip-deduction" label="Other deduction (₹)" inputMode="decimal" value={deduction} onChange={(e) => setDeduction(e.target.value)} />
      </div>
      <Field id="slip-note" label="Note on the payslip" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
    </FormDialog>
  );
}

function BankDialog({ slip, open, onClose }: { slip: Payslip; open: boolean; onClose: () => void }) {
  const current = useOpsQuery<BankDetails>(['payroll', 'bank', slip.employeeId], `/hr/employees/${slip.employeeId}/bank`, { enabled: open });
  const saved = current.data?.configured ? current.data : null;
  const [form, setForm] = useState({ holder: '', number: '', ifsc: '', bank: '', upi: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<BankDetails, { id: string; [key: string]: unknown }>('put', KEYS, (v) => `/hr/employees/${v.id}/bank`);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  async function submit() {
    setError(null);
    if (!form.holder.trim()) return setError('Enter the account holder name.');
    if (!/^\d{6,18}$/.test(form.number.trim())) return setError('Account numbers have 6 to 18 digits.');
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(form.ifsc.trim())) return setError('Enter a valid IFSC, for example HDFC0001234.');
    try {
      await save.mutateAsync({ id: slip.employeeId, accountHolder: form.holder.trim(), accountNumber: form.number.trim(), ifsc: form.ifsc.trim().toUpperCase(), ...(form.bank.trim() && { bankName: form.bank.trim() }), ...(form.upi.trim() && { upiId: form.upi.trim() }) });
      toast.success('Bank details saved');
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the bank details.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={`Bank details · ${slip.employeeName}`} description={saved ? `On file: ${saved.accountHolder}, ${saved.accountNumberMasked}, ${saved.ifsc}. Entering new details replaces them. The full number is never shown again.` : 'Where this person is paid. The account number is stored encrypted and only the last four digits are ever shown.'} onSubmit={submit} submitLabel="Save bank details" pending={save.isPending} error={error}>
      <Field id="bank-holder" label="Account holder" value={form.holder} autoComplete="off" onChange={set('holder')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bank-number" label="Account number" inputMode="numeric" value={form.number} autoComplete="off" onChange={set('number')} />
        <Field id="bank-ifsc" label="IFSC" value={form.ifsc} autoComplete="off" maxLength={11} onChange={set('ifsc')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bank-name" label="Bank name" value={form.bank} autoComplete="off" onChange={set('bank')} />
        <Field id="bank-upi" label="UPI id (optional)" value={form.upi} autoComplete="off" onChange={set('upi')} />
      </div>
    </FormDialog>
  );
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const run = useOpsQuery<PayrollRunDetail>(['payroll', 'run', runId], `/hr/payroll/runs/${runId}`);
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [bank, setBank] = useState<Payslip | null>(null);
  const finalize = useOpsMutation<PayrollRunDetail, { id: string }>('post', KEYS, (v) => `/hr/payroll/runs/${v.id}/finalize`);
  const pay = useOpsMutation<PayrollRunDetail, { id: string }>('post', KEYS, (v) => `/hr/payroll/runs/${v.id}/pay`);
  const discard = useOpsMutation<null, { id: string }>('delete', KEYS, (v) => `/hr/payroll/runs/${v.id}`);
  const data = run.data;
  const act = (fn: () => Promise<unknown>, message: string) => { void fn().then(() => toast.success(message)).catch((e: Error) => toast.error(e.message)); };
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>All payroll runs</Button>
      <QueryState query={{ ...run, isEmpty: false }}>
        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Payroll for {data.month} <Badge variant={STATUS_VARIANT[data.status]} className="ml-2">{humanize(data.status)}</Badge></h2>
                <p className="text-sm text-muted-foreground">{data.headcount} employees, net pay <Money paise={data.totalNetPaise} /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.status === 'DRAFT' && <Button variant="outline" disabled={discard.isPending} onClick={() => act(async () => { await discard.mutateAsync({ id: data.id }); onBack(); }, 'Draft discarded')}>Discard draft</Button>}
                {data.status === 'DRAFT' && <Button disabled={finalize.isPending} onClick={() => act(() => finalize.mutateAsync({ id: data.id }), 'Run finalised. Employees can now see their payslips.')}>Finalise run</Button>}
                {data.status === 'FINALIZED' && <Button disabled={pay.isPending} onClick={() => act(() => pay.mutateAsync({ id: data.id }), 'Marked as paid')}>Mark as paid</Button>}
              </div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Unpaid leave</TableHead><TableHead className="text-right">Bonus</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {data.payslips.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.employeeName}<span className="block text-xs font-normal text-muted-foreground">{s.payableDays}/{s.daysInMonth} days · {s.shiftsWorked}/{s.shiftsScheduled} shifts{!s.bankConfigured && ' · no bank details'}</span></TableCell>
                    <TableCell className="text-right"><Money paise={s.basePaise} /></TableCell>
                    <TableCell className="text-right"><Money paise={-s.leaveDeductionPaise} /></TableCell>
                    <TableCell className="text-right"><Money paise={s.bonusPaise} /></TableCell>
                    <TableCell className="text-right"><Money paise={-s.otherDeductionPaise} /></TableCell>
                    <TableCell className="text-right font-medium"><Money paise={s.netPaise} /></TableCell>
                    <TableCell className="space-x-2 text-right">
                      {data.status === 'DRAFT' && <Button size="sm" variant="outline" aria-label={`Adjust ${s.employeeName}`} onClick={() => setSlip(s)}>Adjust</Button>}
                      <Button size="sm" variant="outline" aria-label={`Bank details for ${s.employeeName}`} onClick={() => setBank(s)}>Bank</Button>
                      <a className={buttonVariants({ size: 'sm', variant: 'outline' })} aria-label={`Payslip PDF for ${s.employeeName}`} href={`${API_BASE_URL}/api/v1/hr/payroll/slips/${s.id}/pdf`}>PDF</a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </QueryState>
      {slip && <SlipDialog key={slip.id} slip={slip} open onClose={() => setSlip(null)} />}
      {bank && <BankDialog key={bank.employeeId} slip={bank} open onClose={() => setBank(null)} />}
    </div>
  );
}

export default function PayrollPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('hr:manage');
  const [month, setMonth] = useState(thisMonth());
  const [openId, setOpenId] = useState<string | null>(null);
  const runs = useOpsQuery<PayrollRun[]>(['payroll', 'runs'], '/hr/payroll/runs', { enabled: allowed });
  const create = useOpsMutation<PayrollRunDetail, { month: string }>('post', KEYS, () => '/hr/payroll/runs');
  if (!user) return null;
  if (!allowed) return <NoAccess what="payroll" />;
  const start = () => {
    void create.mutateAsync({ month }).then((run) => { toast.success(`Draft payroll for ${run.month} created`); setOpenId(run.id); }).catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" description="Run payroll for a month, adjust each payslip, then finalise so employees can see theirs." actions={<Button asChild variant="outline"><Link href="/hr">Back to staff</Link></Button>} />
      {openId ? <RunDetail runId={openId} onBack={() => setOpenId(null)} /> : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="payroll-month" label="Month" type="month" value={month} className="w-48" onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Button onClick={start} loading={create.isPending}>Start payroll run</Button>
          </div>
          <QueryState query={{ ...runs, isEmpty: (runs.data ?? []).length === 0 }} empty={{ title: 'No payroll runs yet', description: 'Pick a month and start the first run.' }}>
            <Table>
              <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Employees</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {(runs.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.month}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{humanize(r.status)}</Badge></TableCell>
                    <TableCell className="tabular text-right">{r.headcount}</TableCell>
                    <TableCell className="text-right"><Money paise={r.totalNetPaise} /></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" aria-label={`Open payroll for ${r.month}`} onClick={() => setOpenId(r.id)}>Open</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryState>
        </>
      )}
    </div>
  );
}
