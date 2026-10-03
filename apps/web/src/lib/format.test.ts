import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney } from './format';

describe('club formatting', () => {
  it('formats whole rupees, paise, zero, refunds and Indian digit grouping', () => {
    expect(formatMoney(42000)).toBe('₹420');
    expect(formatMoney(42050)).toBe('₹420.50');
    expect(formatMoney(0)).toBe('₹0');
    expect(formatMoney(-42050)).toBe('-₹420.50');
    expect(formatMoney(12345600)).toBe('₹1,23,456');
  });

  it('uses the club date when UTC is still on the previous day', () => {
    expect(formatDate('2026-10-02T20:00:00Z')).toBe('3 Oct 2026');
    expect(formatDateTime('2026-10-02T20:00:00Z')).toBe('3 Oct 2026, 1:30 am');
    expect(formatDate('2026-10-03')).toBe('3 Oct 2026');
  });
});
