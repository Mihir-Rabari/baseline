import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Booking } from '@packages/validation';
import { BookingCards } from './booking-table';

const booking = (paymentStatus: Booking['paymentStatus']) => ({
  id: 'b0000000-0000-4000-8000-000000000001', court: { id: 'c0000000-0000-4000-8000-000000000001', name: 'Padel 1', type: 'PADEL' }, kind: 'STANDARD', member: null, guest: { name: 'Riya', phone: '9876543210' },
  startsAt: '2030-01-10T04:30:00.000Z', endsAt: '2030-01-10T05:30:00.000Z', bookingDate: '2030-01-10', status: 'CONFIRMED', cancelledLate: false, channel: 'WEBSITE_TRIAL',
  basePricePaise: 100000, discountPct: 0, pricePaise: 100000, paymentStatus, socialSessionId: null, createdAt: '2030-01-01T00:00:00.000Z',
}) as Booking;

describe('booking cards', () => {
  it('shows paid and due for a part-paid booking', () => {
    render(<BookingCards bookings={[booking('PARTIAL')]} />);
    expect(screen.getByText('Paid ₹200, due ₹800')).toBeInTheDocument();
  });
  it.each(['PAID', 'UNPAID', 'WAIVED', 'REFUNDED'] as const)('shows nothing extra when %s', (status) => {
    render(<BookingCards bookings={[booking(status)]} />);
    expect(screen.queryByText(/^Paid /)).not.toBeInTheDocument();
  });
});
