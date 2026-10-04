import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PayrollPage from '../../../../../../../apps/web/src/app/(app)/hr/payroll/page';

const RUN = '11111111-1111-4111-8111-111111111111';
const EMP = '22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({ allowed: true, post: vi.fn(), put: vi.fn(), del: vi.fn(), status: 'DRAFT', suggested: 0 }));
const slip = { id: '33333333-3333-4333-8333-333333333333', runId: RUN, month: '2030-03', employeeId: EMP, employeeName: 'Asha Rao', position: 'Bar', department: 'BAR', monthlySalaryPaise: 3000000, daysInMonth: 31, payableDays: 31, basePaise: 3000000, unpaidLeaveDays: 0, leaveDeductionPaise: 0, bonusPaise: 0, otherDeductionPaise: 0, netPaise: 3000000, approvedLeaveDays: 2, shiftsScheduled: 20, shiftsWorked: 18, note: null, bankConfigured: false, suggestedUnpaidLeaveDays: 0 };

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'owner' }, hasPermission: () => state.allowed }) }));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: (key: string[]) => ({
    data: key[1] === 'runs'
      ? [{ id: RUN, month: '2030-03', status: state.status, headcount: 1, totalNetPaise: 3000000, createdAt: '2030-03-31T00:00:00.000Z', finalizedAt: null, paidAt: null }]
      : key[1] === 'bank' ? { configured: false }
      : { id: RUN, month: '2030-03', status: state.status, headcount: 1, totalNetPaise: 3000000, createdAt: '2030-03-31T00:00:00.000Z', finalizedAt: null, paidAt: null, payslips: [{ ...slip, suggestedUnpaidLeaveDays: state.suggested }] },
    isPending: false, error: null, refetch: vi.fn(),
  }),
  useOpsMutation: (method: string) => ({ isPending: false, mutateAsync: method === 'post' ? state.post : method === 'delete' ? state.del : state.put }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('payroll page', () => {
  beforeEach(() => {
    state.allowed = true; state.status = 'DRAFT'; state.suggested = 0;
    state.post.mockReset().mockResolvedValue({ id: RUN, month: '2030-03' });
    state.put.mockReset().mockResolvedValue({});
    state.del.mockReset().mockResolvedValue(null);
  });

  it('is closed to anyone without hr:manage', () => {
    state.allowed = false;
    render(<PayrollPage />);
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
  });

  it('starts a run for the chosen month and opens it', async () => {
    render(<PayrollPage />);
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2030-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start payroll run' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith({ month: '2030-03' }));
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('validates adjustments before saving them', async () => {
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open payroll for 2030-03' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust Asha Rao' }));
    fireEvent.change(screen.getByLabelText('Unpaid leave days'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payslip' }));
    await screen.findByText('Unpaid leave must be a whole number from 0 to 31.');
    expect(state.put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Unpaid leave days'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Bonus (₹)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payslip' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: slip.id, unpaidLeaveDays: 2, bonusPaise: 50000, otherDeductionPaise: 0, note: null }));
  });

  it('validates bank details and never asks to show an existing number', async () => {
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open payroll for 2030-03' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bank details for Asha Rao' }));
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Asha Rao' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '12ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bank details' }));
    await screen.findByText('Account numbers have 6 to 18 digits.');
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '123456789012' } });
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'hdfc0001234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bank details' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: EMP, accountHolder: 'Asha Rao', accountNumber: '123456789012', ifsc: 'HDFC0001234' }));
  });

  it('finalises a draft, and offers payment only once finalised', async () => {
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open payroll for 2030-03' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finalise run' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith({ id: RUN }));
    expect(screen.queryByRole('button', { name: 'Mark as paid' })).not.toBeInTheDocument();
  });

  it('freezes a finalised run: no adjusting, but PDFs and payment remain', async () => {
    state.status = 'FINALIZED';
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open payroll for 2030-03' }));
    expect(await screen.findByRole('button', { name: 'Mark as paid' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust Asha Rao' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payslip PDF for Asha Rao' })).toHaveAttribute('href', expect.stringContaining(`/hr/payroll/slips/${slip.id}/pdf`));
  });
  it('suggests unpaid days when leave goes past the allowance, and applies them on request', async () => {
    state.suggested = 3;
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open payroll for 2030-03' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust Asha Rao' }));
    expect(within(screen.getByRole('dialog')).getByText(/Suggested:/)).toHaveTextContent('3 unpaid days');
    expect(screen.getByLabelText('Unpaid leave days')).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }));
    expect(screen.getByLabelText('Unpaid leave days')).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Use suggestion' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save payslip' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith(expect.objectContaining({ id: slip.id, unpaidLeaveDays: 3 })));
  });

  it('shows no suggestion when leave is within the allowance', async () => {
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open payroll for 2030-03' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust Asha Rao' }));
    expect(screen.queryByRole('button', { name: 'Use suggestion' })).not.toBeInTheDocument();
  });

});
