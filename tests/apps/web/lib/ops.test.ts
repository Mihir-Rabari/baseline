import { describe, expect, it } from 'vitest';
import { qs } from '../../../../apps/web/src/lib/ops';
import { humanize } from '@/components/club/ops-bits';

describe('qs', () => {
  it('drops empty values and encodes the rest', () => {
    expect(qs({ status: '', page: 2, q: 'a b&c', flag: false, none: undefined, nothing: null })).toBe('?page=2&q=a+b%26c&flag=false');
  });
  it('returns an empty string when nothing is set', () => {
    expect(qs({ a: '', b: undefined })).toBe('');
  });
});

describe('humanize', () => {
  it('turns enum codes into readable labels and keeps UPI capitalised', () => {
    expect(humanize('FRONT_DESK')).toBe('Front desk');
    expect(humanize('OUT_FOR_DELIVERY')).toBe('Out for delivery');
    expect(humanize('UPI')).toBe('UPI');
  });
});
