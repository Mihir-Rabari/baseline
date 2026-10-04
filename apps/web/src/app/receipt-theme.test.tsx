import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderDetailDialog } from '@/components/club/order-detail-dialog';
import { BookingReceipt } from '@/components/club/booking-receipt';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
};

describe('Receipts are dark text on white in every theme (#78)', () => {
  it('.receipt-paper pins a white background, dark text and light-mode tokens on the element itself', () => {
    const paper = block('.receipt-paper');
    expect(paper).toMatch(/background-color:\s*#ffffff/i);
    expect(paper).toMatch(/color:\s*#09090b/i);
    expect(paper).toMatch(/color-scheme:\s*light/);
    // Tokens used by muted text, borders and cards must not inherit the dark theme values.
    for (const token of ['--background', '--foreground', '--card', '--muted', '--muted-foreground', '--border', '--primary']) {
      expect(paper).toContain(`${token}:`);
    }
    expect(paper).toMatch(/--foreground:\s*240 10% 4%/);
    expect(paper).toMatch(/--background:\s*0 0% 100%/);
  });

  it('@media print forces the light palette even when the app is in dark mode', () => {
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/:root,\s*\.dark\s*\{/);
    expect(print).toMatch(/--background:\s*0 0% 100% !important/);
    expect(print).toMatch(/--foreground:\s*240 10% 4% !important/);
    expect(print).toMatch(/color-scheme:\s*light !important/);
    expect(print).toMatch(/body\s*\{[^}]*background-color:\s*#ffffff !important/);
    expect(print).toMatch(/div\[role="dialog"\]\s*\{[^}]*background:\s*#ffffff !important/);
  });

  it('the order receipt preview in the dialog is receipt paper, also under the dark theme', () => {
    document.documentElement.classList.add('dark');
    render(
      <OrderDetailDialog
        open
        onOpenChange={() => {}}
        order={{
          id: 'o1', orderNumber: 'ORD-000007', channel: 'POS', fulfilment: 'PICKUP', status: 'COMPLETED', createdAt: '2026-10-03T12:00:00.000Z',
          member: null, customerName: 'Riya', deliveryAddress: null,
          items: [{ name: 'Match Ball', qty: 1, unitPricePaise: 40000, lineTotalPaise: 40000, discountPct: 0 }],
          subtotalPaise: 40000, discountPaise: 0, deliveryFeePaise: 0, totalPaise: 40000, paymentStatus: 'PAID',
        } as never}
      />
    );
    expect(screen.getByTestId('order-receipt-content')).toHaveClass('receipt-paper');
    document.documentElement.classList.remove('dark');
  });

  it('the booking receipt is receipt paper and hides its print button when printing', () => {
    render(
      <BookingReceipt
        paidPaise={12000}
        duePaise={48000}
        booking={{
          id: '3f2a9c1e-0000-4000-8000-000000000001', court: { id: 'c', name: 'Tennis Court 1', type: 'TENNIS' }, kind: 'STANDARD', member: null,
          guest: { name: 'Riya', phone: '9876543210', email: null }, startsAt: '2099-01-01T06:30:00.000Z', endsAt: '2099-01-01T07:30:00.000Z',
          bookingDate: '2099-01-01', status: 'CONFIRMED', cancelledLate: false, channel: 'ONLINE', basePricePaise: 60000, discountPct: 0,
          pricePaise: 60000, paidPaise: 12000, paymentStatus: 'PARTIAL', socialSessionId: null, createdAt: '2098-12-31T00:00:00.000Z',
        }}
      />
    );
    expect(screen.getByTestId('booking-receipt')).toHaveClass('receipt-paper');
    expect(screen.getByRole('button', { name: 'Print receipt' })).toHaveClass('print:hidden');
  });
});
