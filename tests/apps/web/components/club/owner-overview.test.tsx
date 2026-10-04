import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerOverview } from '@packages/validation';
import { OverviewCards } from '../../../../../apps/web/src/components/club/owner-overview';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const data: OwnerOverview = {
  generatedAt: '2030-03-10T10:00:00.000Z', pendingOrders: 2, openTabs: 1, staffOnShiftCount: 1,
  upcomingBookings: [{ id: '11111111-1111-4111-8111-111111111111', court: 'Padel 1', sport: 'Padel', startsAt: '2030-03-10T12:30:00.000Z', endsAt: '2030-03-10T13:30:00.000Z', who: 'Asha Rao' }],
  staffOnShift: [{ name: 'Dev Patel', role: 'FRONT_DESK', since: '2030-03-10T03:30:00.000Z' }],
  recentPayments: [
    { paidAt: '2030-03-10T09:00:00.000Z', source: 'COURT', kind: 'PAYMENT', method: 'UPI', amountPaise: 90000, who: 'Asha Rao' },
    { paidAt: '2030-03-10T08:00:00.000Z', source: 'SHOP', kind: 'REFUND', method: 'CASH', amountPaise: -40000, who: null },
  ],
};

describe('owner overview', () => {
  it('shows what is next, who is working and the latest money', () => {
    render(<OverviewCards data={data} />);
    expect(within(screen.getByRole('region', { name: 'Up next on court' })).getByText('Asha Rao')).toBeInTheDocument();
    const shift = screen.getByRole('region', { name: 'On shift now' });
    expect(within(shift).getByText('Dev Patel')).toBeInTheDocument();
    expect(within(shift).getByText('2 open orders')).toBeInTheDocument();
    expect(within(shift).getByText('1 open bar tab')).toBeInTheDocument();
    const pay = screen.getByRole('region', { name: 'Latest payments' });
    expect(within(pay).getByText('Shop refund')).toBeInTheDocument();
    expect(within(pay).getByText(/Walk-in/)).toBeInTheDocument();
  });

  it('has friendly empty states', () => {
    render(<OverviewCards data={{ ...data, upcomingBookings: [], staffOnShift: [], recentPayments: [], pendingOrders: 0, openTabs: 0 }} />);
    expect(screen.getByText('No upcoming bookings.')).toBeInTheDocument();
    expect(screen.getByText('Nobody has clocked in.')).toBeInTheDocument();
    expect(screen.getByText('No payments recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('0 open orders')).toBeInTheDocument();
  });
});
