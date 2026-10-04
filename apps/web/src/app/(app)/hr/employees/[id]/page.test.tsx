import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeProfilePage from './page';

const EMP = '22222222-2222-4222-8222-222222222222';
const PHOTO = '/api/v1/media/employee/123e4567-e89b-42d3-a456-426614174000.png';
const profile = { id: EMP, fullName: 'Asha Rao', position: 'Bartender', department: 'BAR', monthlySalaryPaise: 3000000, hiredOn: '2026-01-01', status: 'ACTIVE', leaveDaysThisYear: 3, photoUrl: null as string | null, email: 'asha@example.com', phone: null, pendingLeaveRequests: 1 };
const slip = { id: '33333333-3333-4333-8333-333333333333', month: '2030-03', netPaise: 2900000 };
const state = vi.hoisted(() => ({ permissions: new Set<string>(), put: vi.fn(), enabled: [] as string[], bank: { configured: true, accountHolder: 'Asha Rao', accountNumberMasked: '********5544', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', upiId: null } as unknown, slips: [] as unknown[], docs: [] as unknown[], profile: null as unknown }));

vi.mock('next/link', () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: EMP }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: (p: string) => state.permissions.has(p) }) }));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: (key: string[], path: string, options: { enabled?: boolean } = {}) => {
    if (options.enabled !== false) state.enabled.push(path);
    const data = options.enabled === false ? undefined : path.endsWith('/bank') ? state.bank : path.endsWith('/payslips') ? state.slips : path.endsWith('/documents') ? state.docs : state.profile;
    return { data, isPending: false, error: null, refetch: vi.fn() };
  },
  useOpsMutation: () => ({ isPending: false, mutateAsync: state.put }),
}));
vi.mock('@/components/club/image-uploader', () => ({
  ImageUploader: ({ kind, value, onChange }: { kind: string; value: string | null; onChange: (url: string | null) => void }) => (
    <div data-testid="uploader" data-kind={kind} data-value={value ?? ''}>
      <button type="button" onClick={() => onChange(PHOTO)}>Pick photo</button>
      <button type="button" onClick={() => onChange(null)}>Drop photo</button>
    </div>
  ),
}));

describe('employee profile page', () => {
  beforeEach(() => {
    state.permissions = new Set(['hr:read', 'hr:manage']);
    state.enabled = [];
    state.profile = { ...profile };
    state.slips = [slip];
    state.docs = [];
    state.bank = { configured: true, accountHolder: 'Asha Rao', accountNumberMasked: '********5544', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', upiId: null };
    state.put.mockReset().mockResolvedValue({});
  });

  it('shows details, salary, leave summary, masked bank details and payslips to the owner', () => {
    render(<EmployeeProfilePage />);
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('Bartender, Bar')).toBeInTheDocument();
    expect(screen.getByText('₹30,000')).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText(/account \*{8}5544/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change on the payroll screen' })).toHaveAttribute('href', '/hr/payroll');
    expect(screen.getByRole('link', { name: 'Payslip PDF for 2030-03' }).getAttribute('href')).toContain(`/hr/payroll/slips/${slip.id}/pdf`);
    expect(screen.getByRole('link', { name: /All staff/ })).toHaveAttribute('href', '/hr');
  });

  it('sets and removes the photo through the employee update call', async () => {
    render(<EmployeeProfilePage />);
    expect(screen.getByTestId('uploader')).toHaveAttribute('data-kind', 'employee');
    fireEvent.click(screen.getByRole('button', { name: 'Pick photo' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: EMP, photoUrl: PHOTO }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop photo' }));
    await waitFor(() => expect(state.put).toHaveBeenLastCalledWith({ id: EMP, photoUrl: null }));
  });

  it('offers no photo editing, bank or payslips to someone who can only read staff', () => {
    state.permissions = new Set(['hr:read']);
    render(<EmployeeProfilePage />);
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.queryByTestId('uploader')).not.toBeInTheDocument();
    expect(screen.queryByText('Bank details')).not.toBeInTheDocument();
    expect(screen.queryByText('Payslips')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
    expect(state.enabled.some((path) => path.endsWith('/bank') || path.endsWith('/payslips') || path.endsWith('/documents'))).toBe(false);
  });

  it('shows the documents section to the owner', () => {
    render(<EmployeeProfilePage />);
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(state.enabled).toContain(`/hr/employees/${EMP}/documents`);
  });

  it('is closed, and loads nothing, without hr:read', () => {
    state.permissions = new Set(['leave:read:self']);
    render(<EmployeeProfilePage />);
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
    expect(state.enabled).toEqual([]);
  });

  it('says so when no bank details or payslips exist yet', () => {
    state.bank = { configured: false };
    state.slips = [];
    render(<EmployeeProfilePage />);
    expect(screen.getByText(/No bank details yet/)).toBeInTheDocument();
    expect(screen.getByText('No payslips yet')).toBeInTheDocument();
  });
});
