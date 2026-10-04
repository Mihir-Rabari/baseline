'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import type { BankDetails, EmployeeProfile, Payslip } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { API_BASE_URL } from '@/lib/api-client';
import { mediaUrl } from '@/lib/upload-api';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { errorText } from '@/components/club/form-dialog';
import { EmployeeDocuments } from '@/components/club/employee-documents';
import { ImageUploader } from '@/components/club/image-uploader';
import { NoAccess, QueryState, Stat, humanize } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEY = 'hr-employee';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd>{children}</dd></div>;
}

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('hr:read');
  const canManage = hasPermission('hr:manage');
  const profile = useOpsQuery<EmployeeProfile>([KEY, id], `/hr/employees/${id}`, { enabled: canRead });
  const bank = useOpsQuery<BankDetails>([KEY, 'bank', id], `/hr/employees/${id}/bank`, { enabled: canManage });
  const slips = useOpsQuery<Payslip[]>([KEY, 'slips', id], `/hr/employees/${id}/payslips`, { enabled: canManage });
  const save = useOpsMutation<EmployeeProfile, { id: string; photoUrl: string | null }>('put', [KEY, 'hr'], (v) => `/hr/employees/${v.id}`);

  if (!canRead) return <NoAccess what="employee profiles" />;

  async function setPhoto(photoUrl: string | null) {
    try {
      await save.mutateAsync({ id, photoUrl });
      toast.success(photoUrl ? 'Photo saved' : 'Photo removed');
    } catch (caught) { toast.error(errorText(caught, 'Could not save the photo.')); }
  }

  const person = profile.data;
  const photo = mediaUrl(person?.photoUrl);
  return (
    <div className="space-y-8">
      <PageHeader
        title={person?.fullName ?? 'Employee'}
        description={person ? `${person.position}, ${humanize(person.department)}` : 'Profile, leave and payslips.'}
        actions={<Link href="/hr" className={buttonVariants({ variant: 'outline' })}><ArrowLeft className="mr-2 h-4 w-4" aria-hidden />All staff</Link>}
      />
      <QueryState query={profile}>
        {person && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Monthly salary" value={<Money paise={person.monthlySalaryPaise} />} />
              <Stat label="Leave taken this year" value={`${person.leaveDaysThisYear} days`} />
              <Stat label="Leave awaiting a decision" value={person.pendingLeaveRequests} />
            </div>
            <section aria-labelledby="details-heading" className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-4">
                <h2 id="details-heading" className="text-lg font-semibold">Details</h2>
                <dl className="divide-y rounded-lg border px-4">
                  <Detail label="Status"><Badge variant={person.status === 'ACTIVE' ? 'success' : 'outline'}>{person.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></Detail>
                  <Detail label="Position">{person.position}</Detail>
                  <Detail label="Department">{humanize(person.department)}</Detail>
                  <Detail label="Hired on">{person.hiredOn}</Detail>
                  <Detail label="Email">{person.email ?? 'Not recorded'}</Detail>
                  <Detail label="Phone">{person.phone ?? 'Not recorded'}</Detail>
                </dl>
              </div>
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Photo</h2>
                {canManage
                  ? <ImageUploader kind="employee" label={`Photo of ${person.fullName}`} value={person.photoUrl ?? null} onChange={(url) => { void setPhoto(url); }} disabled={save.isPending} />
                  : photo ? <img src={photo} alt={`Photo of ${person.fullName}`} className="h-32 w-32 rounded-lg border object-cover" /> : <p className="text-sm text-muted-foreground">No photo.</p>}
              </div>
            </section>
            {canManage && (
              <section aria-labelledby="bank-heading" className="space-y-4">
                <h2 id="bank-heading" className="text-lg font-semibold">Bank details</h2>
                <QueryState query={bank}>
                  {bank.data?.configured
                    ? <p className="text-sm">{bank.data.accountHolder}, account {bank.data.accountNumberMasked}, {bank.data.ifsc}{bank.data.bankName ? `, ${bank.data.bankName}` : ''}. <Link className="underline" href="/hr/payroll">Change on the payroll screen</Link>.</p>
                    : <p className="text-sm text-muted-foreground">No bank details yet. <Link className="underline" href="/hr/payroll">Add them on the payroll screen</Link>.</p>}
                </QueryState>
              </section>
            )}
            {canManage && (
              <section aria-labelledby="slips-heading" className="space-y-4">
                <h2 id="slips-heading" className="text-lg font-semibold">Payslips</h2>
                <QueryState query={{ ...slips, isEmpty: !slips.data?.length }} empty={{ title: 'No payslips yet', description: 'Payslips appear once a payroll run includes this employee.' }}>
                  <Table>
                    <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead><span className="sr-only">Download</span></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {slips.data?.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.month}</TableCell>
                          <TableCell className="text-right"><Money paise={s.netPaise} /></TableCell>
                          <TableCell className="text-right"><a className={buttonVariants({ size: 'sm', variant: 'outline' })} aria-label={`Payslip PDF for ${s.month}`} href={`${API_BASE_URL}/api/v1/hr/payroll/slips/${s.id}/pdf`}>PDF</a></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryState>
              </section>
            )}
            {canManage && <EmployeeDocuments employeeId={id} />}
          </>
        )}
      </QueryState>
    </div>
  );
}
