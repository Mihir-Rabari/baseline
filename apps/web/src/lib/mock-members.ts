import { MemberListQuerySchema, MemberPageSchema, type MemberListQuery, type MemberPage } from '@packages/validation';
import fixture from '@/mocks/members.json';

export const mockMemberStore = MemberPageSchema.parse(fixture).data;

export function listMockMembers(params: Partial<MemberListQuery> = {}): MemberPage {
  const query = MemberListQuerySchema.parse(params);
  const search = query.q?.toLocaleLowerCase();
  const filtered = mockMemberStore.filter((member) => {
    if (search && ![member.fullName, member.phone, member.memberCode].some((value) => value.toLocaleLowerCase().includes(search))) return false;
    if (query.planCode && member.membership?.plan.code !== query.planCode) return false;
    if (query.status === 'NONE' && member.membership !== null) return false;
    if (query.status === 'ACTIVE' && member.membership?.status !== 'ACTIVE') return false;
    if (query.status === 'EXPIRED' && member.membership?.expiryState !== 'EXPIRED') return false;
    if (query.status === 'EXPIRING_SOON' && member.membership?.expiryState !== 'EXPIRING_SOON') return false;
    return true;
  });
  const totalPages = Math.ceil(filtered.length / query.limit);
  return {
    data: filtered.slice((query.page - 1) * query.limit, query.page * query.limit),
    meta: {
      page: query.page, limit: query.limit, totalItems: filtered.length, totalPages,
      hasPrevPage: query.page > 1, hasNextPage: query.page < totalPages,
    },
  };
}
