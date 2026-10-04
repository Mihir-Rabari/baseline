import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentDialog, checkoutTerms } from './payment-dialog';

describe('checkoutTerms (all purchase kinds)', () => {
  it('UPI and card always pay in full now', () => {
    for (const cash of ['promise-fee', 'at-pickup', 'at-counter'] as const) {
      expect(checkoutTerms('UPI', 60000, cash)).toMatchObject({ nowPaise: 60000, laterPaise: 0 });
      expect(checkoutTerms('CARD', 60000, cash)).toMatchObject({ nowPaise: 60000, laterPaise: 0 });
    }
  });
  it('cash depends on the purchase: promise fee for bookings, nothing for pickup orders, full at the counter', () => {
    expect(checkoutTerms('CASH', 60000, 'promise-fee')).toMatchObject({ nowPaise: 12000, laterPaise: 48000 });
    expect(checkoutTerms('CASH', 60000, 'at-pickup')).toMatchObject({ nowPaise: 0, laterPaise: 60000 });
    expect(checkoutTerms('CASH', 60000, 'at-counter')).toMatchObject({ nowPaise: 60000, laterPaise: 0 });
  });
});

describe('PaymentDialog flow', () => {
  const setup = (props: Partial<React.ComponentProps<typeof PaymentDialog>> = {}) => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PaymentDialog open onClose={() => {}} title="Take payment" totalPaise={50000} cash="at-counter" onConfirm={onConfirm} {...props} />);
    return { onConfirm, dialog: screen.getByRole('dialog', { name: 'Take payment' }) };
  };
  it('starts on the default method and confirms with the chosen one', async () => {
    const { onConfirm, dialog } = setup({ initialMethod: 'CARD' });
    expect(within(dialog).getByRole('radio', { name: 'Card' })).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText('Cash'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay ₹500' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('CASH'));
  });
  it('shows the failure inside the dialog and lets the payer try again', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('Card declined')).mockResolvedValue(undefined);
    const { dialog } = setup({ onConfirm });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay ₹500' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Card declined'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay ₹500' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });
});
