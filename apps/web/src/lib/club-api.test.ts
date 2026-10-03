import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreateEnquiryResponseSchema, MemberPageSchema, PlanListSchema, PublicClubSchema,
} from '@packages/validation';
import plans from '@/mocks/plans.json';
import club from '@/mocks/club.json';
import enquiry from '@/mocks/enquiry.json';
import members from '@/mocks/members.json';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('club API contracts', () => {
  it('validates mock fixtures against published backend response schemas', () => {
    expect(() => PlanListSchema.parse(plans)).not.toThrow();
    expect(() => PublicClubSchema.parse(club)).not.toThrow();
    expect(() => CreateEnquiryResponseSchema.parse(enquiry)).not.toThrow();
    expect(() => MemberPageSchema.parse(members)).not.toThrow();
  });

  it('posts an enquiry to the contracted endpoint with credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(enquiry), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    const data = { name: 'Riya Patel', email: 'riya@example.com', message: 'Interested in joining the club.' };
    expect(await api.public.createEnquiry(data)).toEqual(enquiry);
    expect(fetch).toHaveBeenCalledWith('https://club.example/api/v1/public/enquiries', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify(data),
    }));
  });

  it('encodes member filters and omits missing query parameters', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(members), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    await api.members.list({ q: 'Aarav & Riya', planCode: 'GOLD', page: 2, limit: 5, status: undefined });
    expect(fetch.mock.calls[0][0]).toBe('https://club.example/api/v1/members?q=Aarav+%26+Riya&planCode=GOLD&page=2&limit=5');
    await api.members.list();
    expect(fetch.mock.calls[1][0]).toBe('https://club.example/api/v1/members');
  });

  it('returns a delayed mock enquiry without a network request', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    vi.useFakeTimers();
    const response = api.public.createEnquiry({ name: 'Riya Patel', phone: '9876543210', message: 'Can I join?' });
    await vi.advanceTimersByTimeAsync(500);
    expect(await response).toEqual(enquiry);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses authenticated member endpoints and preserves mutation payloads', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    const id = 'member/with space';
    const registration = { fullName: 'Riya Patel', phone: '9876543210', planId: plans[0].id, startsOn: '2026-10-03', paymentMethod: 'CASH' as const };
    await api.members.get(id);
    await api.members.timeline(id);
    await api.members.create(registration);
    await api.members.checkin(id);
    await api.members.renew(id, { paymentMethod: 'UPI' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://club.example/api/v1/members/member%2Fwith%20space',
      'https://club.example/api/v1/members/member%2Fwith%20space/timeline',
      'https://club.example/api/v1/members',
      'https://club.example/api/v1/members/member%2Fwith%20space/checkin',
      'https://club.example/api/v1/members/member%2Fwith%20space/membership/renew',
    ]);
    for (const [, options] of fetch.mock.calls) expect(options.credentials).toBe('include');
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(registration) });
    expect(fetch.mock.calls[3][1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(fetch.mock.calls[4][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ paymentMethod: 'UPI' }) });
  });
});
