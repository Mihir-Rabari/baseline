import { describe, expect, it } from 'vitest';
import { MemberPageSchema } from '@packages/validation';
import { listMockMembers } from './mock-members';

describe('mock member listing', () => {
  it('returns eight members in the shared contract, including absent membership', () => {
    const result = MemberPageSchema.parse(listMockMembers({}));
    expect(result.data).toHaveLength(8);
    expect(result.data.some((member) => member.membership === null)).toBe(true);
  });
  it.each(['AARAV', '9876543201', 'cc-000001'])('matches %s by name, phone or code without case sensitivity', (q) => {
    expect(listMockMembers({ q }).data.map((member) => member.fullName)).toEqual(['Aarav Mehta']);
  });
  it('filters before computing pagination and combines search with plan', () => {
    const first = listMockMembers({ planCode: 'GOLD', page: 1, limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.meta).toEqual({ page: 1, limit: 2, totalItems: 3, totalPages: 2, hasNextPage: true, hasPrevPage: false });
    const last = listMockMembers({ planCode: 'GOLD', page: 2, limit: 2 });
    expect(last.data).toHaveLength(1);
    expect(last.meta.hasPrevPage).toBe(true);
    expect(last.meta.hasNextPage).toBe(false);
    expect(listMockMembers({ q: 'Aarav', planCode: 'SILVER' }).meta.totalItems).toBe(0);
  });
  it('supports expiry and no membership filters and empty metadata', () => {
    expect(listMockMembers({ status: 'EXPIRING_SOON' }).data).toHaveLength(2);
    expect(listMockMembers({ status: 'EXPIRED' }).data).toHaveLength(2);
    expect(listMockMembers({ status: 'NONE' }).data).toHaveLength(1);
    expect(listMockMembers({ q: 'missing' }).meta).toMatchObject({ totalItems: 0, totalPages: 0, hasNextPage: false });
  });
  it('rejects a search shorter than the API minimum', () => {
    expect(() => listMockMembers({ q: 'a' })).toThrow();
  });
});
