import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberPageSchema } from '@packages/validation';
import { ApiError } from '@/lib/api-client';
import fixture from '@/mocks/members.json';
import MembershipPage from '../../../../../../apps/web/src/app/(app)/membership/page';

const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as Error | null, isPending: false, refetch: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-bookings', () => ({ useMyMember: () => state }));

const members = MemberPageSchema.parse(fixture).data;

describe('my membership page', () => {
  beforeEach(() => { vi.clearAllMocks(); Object.assign(state, { data: members[0], error: null, isPending: false }); });

  it('shows the plan, dates, days left and entitlements', () => {
    render(<MembershipPage />);
    expect(screen.getByRole('heading', { name: 'Gold' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('28 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Court discount').nextSibling).toHaveTextContent('100%');
    expect(screen.getByText('Book ahead').nextSibling).toHaveTextContent('14 days');
  });

  it('shows an expiry warning state for an expiring plan', () => {
    state.data = members[1];
    render(<MembershipPage />);
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();
  });

  it('offers plans when the account has no member profile (404)', () => {
    state.data = undefined; state.error = new ApiError('This account has no member profile.', 404, 'NOT_A_MEMBER');
    render(<MembershipPage />);
    expect(screen.getByText('No membership yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans');
  });

  it('offers plans when the member has no membership', () => {
    state.data = { ...members[0], membership: null };
    render(<MembershipPage />);
    expect(screen.getByText('No active plan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  it('renders loading and a retryable error for real failures', () => {
    state.data = undefined; state.isPending = true;
    const { rerender } = render(<MembershipPage />);
    expect(screen.getByRole('status', { name: 'Loading membership' })).toBeInTheDocument();
    state.isPending = false; state.error = new ApiError('Service unavailable', 503);
    rerender(<MembershipPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
