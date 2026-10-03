import { PlanSchema, UpdatePlanRequestSchema, SocialWindowListSchema, UpdateSocialWindowRequestSchema, type UpdatePlanRequest, type UpdateSocialWindowRequest } from '@packages/validation';
import { ApiError, fetchApi, USE_MOCKS, mock } from './api-client';
import plans from '@/mocks/plans.json';
import { mockMemberStore } from './mock-members';
const windows = SocialWindowListSchema.parse([{ id: 'f0000000-0000-4000-8000-000000000001', weekday: 5, startsTime: '18:00', endsTime: '22:00', isActive: true }]);
export const clubSettingsApi = {
  updatePlan: async (id: string, input: UpdatePlanRequest) => {
    const data = UpdatePlanRequestSchema.parse(input);
    if (!USE_MOCKS) return PlanSchema.parse(await fetchApi(`/api/v1/plans/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }));
    const plan = plans.find(item => item.id === id); if (!plan) throw new ApiError('Plan not found', 404); Object.assign(plan, data);
    for (const member of mockMemberStore) {
      if (member.membership?.plan.id !== id) continue;
      member.membership.plan.name = plan.name;
      const active = plan.isActive && member.membership.status === 'ACTIVE' && member.membership.expiryState !== 'EXPIRED';
      member.entitlements = { courtDiscountPct: active ? plan.courtDiscountPct : 0, shopDiscountPct: active ? plan.shopDiscountPct : 0, barDiscountPct: active ? plan.barDiscountPct : 0, maxBookingsPerDay: active ? plan.maxBookingsPerDay : 0, bookingHorizonDays: active ? plan.bookingHorizonDays : 0 };
    }
    return mock(PlanSchema.parse(plan));
  },
  windows: async () => SocialWindowListSchema.parse(USE_MOCKS ? await mock(structuredClone(windows)) : await fetchApi('/api/v1/social-windows')),
  updateWindow: async (id: string, input: UpdateSocialWindowRequest) => {
    const data = UpdateSocialWindowRequestSchema.parse(input);
    if (!USE_MOCKS) return fetchApi(`/api/v1/social-windows/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
    const window = windows.find(item => item.id === id); if (!window) throw new ApiError('Social window not found', 404);
    const merged = { ...window, ...data }; if (merged.endsTime <= merged.startsTime) throw new ApiError('End time must be after start time', 400); Object.assign(window, data); return mock(structuredClone(window));
  },
};
