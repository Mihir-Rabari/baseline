import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import plansMock from '@/mocks/plans.json';
import clubMock from '@/mocks/club.json';
import PlansPage from '../../../../../../apps/web/src/app/(marketing)/plans/page';

const state = vi.hoisted(() => ({
  plans: { data: undefined as unknown, isPending: false, error: null as Error | null, refetch: vi.fn() },
  club: { data: undefined as unknown, isPending: false, error: null as Error | null, refetch: vi.fn() },
}));
vi.mock('@/hooks/use-plans', () => ({ usePlans: () => state.plans, usePublicClub: () => state.club }));

describe('public plans', () => {
  beforeEach(() => {
    state.plans = { data: structuredClone(plansMock), isPending: false, error: null, refetch: vi.fn() };
    state.club = { data: structuredClone(clubMock), isPending: false, error: null, refetch: vi.fn() };
  });

  it('shows plan entitlements, computed tennis prices and enquiry links', () => {
    render(<PlansPage />);
    expect(screen.getAllByRole('row')).toHaveLength(4);
    for (const price of ['Free play', '₹420', '₹300', '₹3,000', '₹1,500', '₹800']) {
      expect(screen.getByText(price)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Enquire about Gold' })).toHaveAttribute('href', '/contact?plan=GOLD');
    expect(screen.getByRole('table')).toHaveClass('min-w-[760px]');
  });

  it('calculates prices from the club rate instead of a fixed base', () => {
    const club = structuredClone(clubMock);
    club.courtTypes[0].baseRatePaise = 80000;
    state.club.data = club;
    render(<PlansPage />);
    expect(screen.getByText('₹560')).toBeInTheDocument();
    expect(screen.getByText('₹400')).toBeInTheDocument();
  });

  it('renders loading while either query is pending', () => {
    state.club.isPending = true;
    render(<PlansPage />);
    expect(screen.getByRole('status', { name: 'Loading plans' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an empty plan list and missing court rates safely', () => {
    state.plans.data = [];
    const { rerender } = render(<PlansPage />);
    expect(screen.getByText('Plans are being updated')).toBeInTheDocument();
    state.plans.data = plansMock;
    state.club.data = { ...clubMock, courtTypes: [] };
    rerender(<PlansPage />);
    expect(screen.getByText('Court prices are being updated')).toBeInTheDocument();
  });

  it.each(['plans', 'club'] as const)('offers retry when %s fails', (query) => {
    state[query].error = new Error('Service unavailable');
    render(<PlansPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.plans.refetch).toHaveBeenCalledOnce();
    expect(state.club.refetch).toHaveBeenCalledOnce();
  });
});
