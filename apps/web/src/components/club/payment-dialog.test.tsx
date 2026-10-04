import { describe, expect, it } from 'vitest';
import { checkoutTerms } from './payment-dialog';

describe('checkout terms', () => {
  it('UPI and card always pay in full now', () => {
    for (const cash of ['promise-fee', 'at-pickup', 'at-counter'] as const) {
      expect(checkoutTerms('UPI', 100000, cash)).toMatchObject({ nowPaise: 100000, laterPaise: 0 });
      expect(checkoutTerms('CARD', 100000, cash)).toMatchObject({ nowPaise: 100000, laterPaise: 0 });
    }
  });
  it('cash for a booking pays the 20% promise fee and leaves the rest for the club', () => {
    expect(checkoutTerms('CASH', 100000, 'promise-fee')).toMatchObject({ nowPaise: 20000, laterPaise: 80000 });
  });
  it('cash for an online order is paid at pickup, and at the POS counter in full now', () => {
    expect(checkoutTerms('CASH', 100000, 'at-pickup')).toMatchObject({ nowPaise: 0, laterPaise: 100000 });
    expect(checkoutTerms('CASH', 100000, 'at-counter')).toMatchObject({ nowPaise: 100000, laterPaise: 0 });
  });
});
