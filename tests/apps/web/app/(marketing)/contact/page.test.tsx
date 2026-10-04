import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import plans from '@/mocks/plans.json';
import ContactPage from '../../../../../../apps/web/src/app/(marketing)/contact/page';

const state = vi.hoisted(() => ({
  plans: { data: undefined as unknown, isPending: false, error: null as Error | null, refetch: vi.fn() },
  enquiry: { isSuccess: false, isPending: false, mutateAsync: vi.fn() },
  plan: 'GOLD',
  toast: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`plan=${state.plan}`) }));
vi.mock('@/hooks/use-plans', () => ({ usePlans: () => state.plans }));
vi.mock('@/hooks/use-enquiry', () => ({ useEnquiry: () => state.enquiry }));
vi.mock('sonner', () => ({ toast: { error: state.toast } }));

function fillContact(email = '') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Riya Kapoor' } });
  fireEvent.change(screen.getByLabelText(email ? 'Email' : 'Phone'), { target: { value: email || '+919811122233' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Tell me about membership' } });
}

describe('Contact enquiry', () => {
  beforeEach(() => {
    state.plans = { data: plans, isPending: false, error: null, refetch: vi.fn() };
    state.enquiry = { isSuccess: false, isPending: false, mutateAsync: vi.fn().mockResolvedValue({}) };
    state.plan = 'GOLD';
    state.toast.mockReset();
  });

  it.each(['', 'riya@example.com'])('submits a valid enquiry and maps preset plan code to its ID (%s)', async (email) => {
    render(<ContactPage />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Gold'));
    fillContact(email);
    fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));
    await waitFor(() => expect(state.enquiry.mutateAsync).toHaveBeenCalledWith({
      name: 'Riya Kapoor', phone: email ? undefined : '+919811122233', email: email || undefined,
      message: 'Tell me about membership', interestedPlanId: plans[0].id,
    }));
  });

  it('blocks an empty submission and shows inline errors', async () => {
    render(<ContactPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(state.enquiry.mutateAsync).not.toHaveBeenCalled();
  });

  it('preselects the requested plan once asynchronous plans arrive', async () => {
    state.plans.data = undefined;
    state.plans.isPending = true;
    const { rerender } = render(<ContactPage />);
    state.plans.data = plans;
    state.plans.isPending = false;
    rerender(<ContactPage />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Gold'));
  });

  it('preserves the chosen plan when the plan list refetches', async () => {
    const { container, rerender } = render(<ContactPage />);
    const nativeSelect = container.querySelector('select');
    expect(nativeSelect).not.toBeNull();
    fireEvent.change(nativeSelect!, { target: { value: plans[1].id } });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Silver'));
    state.plans.data = structuredClone(plans);
    rerender(<ContactPage />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Silver');
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));
    await waitFor(() => expect(state.enquiry.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ interestedPlanId: plans[1].id })));
  });

  it('shows a submission error and retains the form for retry', async () => {
    state.enquiry.mutateAsync.mockRejectedValue(new Error('Please try again later'));
    render(<ContactPage />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith('Please try again later'));
    expect(screen.getByLabelText('Name')).toHaveValue('Riya Kapoor');
  });

  it('disables submission and fields while sending', () => {
    state.enquiry.isPending = true;
    render(<ContactPage />);
    expect(screen.getByRole('button', { name: 'Sending enquiry…' })).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('replaces the form with confirmation after success', () => {
    state.enquiry.isSuccess = true;
    render(<ContactPage />);
    expect(screen.getByRole('status')).toHaveTextContent("Thanks, we'll be in touch within one working day.");
    expect(screen.queryByRole('button', { name: 'Send enquiry' })).not.toBeInTheDocument();
  });

  it('allows enquiries when plans are unavailable and offers a retry', () => {
    state.plans.error = new Error('Plans unavailable');
    state.plans.data = undefined;
    render(<ContactPage />);
    expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.plans.refetch).toHaveBeenCalledOnce();
  });
});
