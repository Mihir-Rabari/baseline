'use client';

import React, { useState } from 'react';
import { Banknote, CreditCard, Smartphone, type LucideIcon } from 'lucide-react';
import { promiseFeePaise, type CheckoutMethod } from '@packages/validation';
import { formatMoney } from '@/lib/format';
import { errorText, FormDialog } from '@/components/club/form-dialog';
import { cn } from '@/lib/utils';

const OPTIONS: Array<{ method: CheckoutMethod; label: string; icon: LucideIcon }> = [
  { method: 'UPI', label: 'UPI', icon: Smartphone },
  { method: 'CARD', label: 'Card', icon: CreditCard },
  { method: 'CASH', label: 'Cash', icon: Banknote },
];

/** What a method means for this purchase, and how much is paid right now. */
export function checkoutTerms(method: CheckoutMethod, totalPaise: number, cash: 'promise-fee' | 'at-pickup') {
  if (method !== 'CASH') return { nowPaise: totalPaise, laterPaise: 0, note: 'Paid in full now.' };
  if (cash === 'promise-fee') {
    const fee = promiseFeePaise(totalPaise);
    return { nowPaise: fee, laterPaise: totalPaise - fee, note: `A 20% promise fee holds your booking. Pay the remaining ${formatMoney(totalPaise - fee)} at the club.` };
  }
  return { nowPaise: 0, laterPaise: totalPaise, note: 'Nothing to pay now. Pay in cash when you collect or receive your order.' };
}

/** The three payment choices as a radio group, with the consequence of the chosen one spelled out. */
export function PaymentMethodPicker({ value, onChange, totalPaise, cash, disabled }: {
  value: CheckoutMethod; onChange: (method: CheckoutMethod) => void; totalPaise: number; cash: 'promise-fee' | 'at-pickup'; disabled?: boolean;
}) {
  const terms = checkoutTerms(value, totalPaise, cash);
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">Payment method</legend>
      <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ method, label, icon: Icon }) => (
          <label key={method} className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring', value === method ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
            <input type="radio" name="payment-method" value={method} checked={value === method} onChange={() => onChange(method)} className="sr-only" />
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </label>
        ))}
      </div>
      <dl className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd className="tabular">{formatMoney(totalPaise)}</dd></div>
        <div className="flex justify-between font-medium"><dt>Pay now</dt><dd className="tabular">{formatMoney(terms.nowPaise)}</dd></div>
        {terms.laterPaise > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Pay later</dt><dd className="tabular">{formatMoney(terms.laterPaise)}</dd></div>}
      </dl>
      <p className="text-xs text-muted-foreground">{terms.note}</p>
    </fieldset>
  );
}

/** A dialog that asks how to pay and completes the purchase when the button is pressed. */
export function PaymentDialog({ open, onClose, title, description, totalPaise, cash, confirmLabel, onConfirm, children }: {
  open: boolean; onClose: () => void; title: string; description?: string; totalPaise: number; cash: 'promise-fee' | 'at-pickup';
  confirmLabel?: string; onConfirm: (method: CheckoutMethod) => Promise<void>; children?: React.ReactNode;
}) {
  const [method, setMethod] = useState<CheckoutMethod>('UPI');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = checkoutTerms(method, totalPaise, cash);
  async function submit() {
    setPending(true); setError(null);
    try { await onConfirm(method); setPending(false); }
    catch (caught) { setPending(false); setError(errorText(caught, 'The payment could not be completed. Nothing was charged.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={title} description={description} onSubmit={submit} pending={pending} error={error}
      submitLabel={confirmLabel ?? (terms.nowPaise > 0 ? `Pay ${formatMoney(terms.nowPaise)}` : 'Place order')}>
      {children}
      <PaymentMethodPicker value={method} onChange={setMethod} totalPaise={totalPaise} cash={cash} disabled={pending} />
    </FormDialog>
  );
}
