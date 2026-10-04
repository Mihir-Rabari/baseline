import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Booking } from '@packages/validation';
import { BookingTable, BookingCards } from './booking-table';

function makeBooking(extra: Partial<Booking> = {}): Booking {
  const start = new Date(Date.now() + 24 * 3600000).toISOString();
  const end = new Date(Date.now() + 25 * 3600000).toISOString();
  return {
    id: 'b1',
    court: { id: 'c1', name: 'Tennis Court 1', type: 'TENNIS' },
    kind: 'STANDARD',
    member: { id: 'm1', memberCode: 'CC-1', fullName: 'Aarav Mehta' },
    guest: null,
    startsAt: start,
    endsAt: end,
    bookingDate: '2026-10-05',
    status: 'CONFIRMED',
    cancelledLate: false,
    channel: 'ONLINE',
    basePricePaise: 60000,
    discountPct: 0,
    pricePaise: 60000,
    paymentStatus: 'UNPAID',
    socialSessionId: null,
    createdAt: start,
    ...extra,
  };
}

describe('BookingTable and BookingCards', () => {
  it('renders booking table with status badge and price', () => {
    const onCancel = vi.fn();
    render(<BookingTable bookings={[makeBooking()]} showWho onCancel={onCancel} />);

    expect(screen.getByText('Tennis Court 1')).toBeInTheDocument();
    expect(screen.getByText('Aarav Mehta')).toBeInTheDocument();
    expect(screen.getByText('₹600')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /^Cancel Tennis Court 1/ });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders "Paid X, due Y" warning badge in BookingTable when paymentStatus is PARTIAL', () => {
    render(<BookingTable bookings={[makeBooking({ paymentStatus: 'PARTIAL', pricePaise: 60000 })]} />);

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/Paid ₹120, due ₹480/)).toBeInTheDocument();
  });

  it('renders "Paid X, due Y" warning badge in BookingCards when paymentStatus is PARTIAL', () => {
    const onCancel = vi.fn();
    render(<BookingCards bookings={[makeBooking({ paymentStatus: 'PARTIAL', pricePaise: 60000 })]} showWho onCancel={onCancel} />);

    expect(screen.getByText('Tennis Court 1')).toBeInTheDocument();
    expect(screen.getByText('Aarav Mehta')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/Paid ₹120, due ₹480/)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
