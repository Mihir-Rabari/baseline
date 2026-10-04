import type { ReadinessResponse, HealthSummaryResponse } from '@packages/shared';
import type { Plan, PublicClub } from './club-types';
import plansMock from '@/mocks/plans.json';
import clubMock from '@/mocks/club.json';
import enquiryMock from '@/mocks/enquiry.json';
import { listMockMembers } from '@/lib/mock-members';
import { mockGetMember, mockCreateMember, mockMemberTimeline, mockCheckinMember, mockRenewMember } from '@/lib/mock-member-operations';
import { mockAvailability, mockCreateBooking, mockCreateTrial, mockListBookings, mockCancelBooking, mockMyMember, MockBookingError } from '@/lib/mock-bookings';
import type {
  SignupRequest,
  LoginRequest,
  SessionResponse,
  AuthUser,
  UpdateProfile,
  ChangePassword,
  UserListQuery,
  UpdateUserStatus,
  CreateRole,
  UpdateRole,
  CreateGroup,
  UpdateGroup,
  CreatePolicy,
  UpdatePolicy,
  EffectivePermissionsResponse,
  Role,
  Group,
  Policy,
  Permission,
  CreateEnquiryRequest,
  CreateEnquiryResponse,
  MemberListQuery,
  MemberPage,
  Member,
  CreateMemberRequest,
  CreateMemberResponse,
  CheckinResponse,
  RenewMembershipRequest,
  RenewMembershipResponse,
  Availability, AvailabilityQuery, CreateTrialBookingRequest, CreateTrialBookingResponse, Booking, BookingPage, BookingListQuery, MyBookingsQuery, CancelBookingRequest, CancelBookingResponse, CreateBookingRequest, JoinSocialRequest, JoinSocialResponse, MemberLookupItem,
} from '@packages/validation';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export const SESSION_EXPIRED_EVENT = 'app:session-expired';
export const USE_MOCKS =process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export const mock = <T,>(data: T, ms = 300): Promise<T> =>
  new Promise<T>((resolve) => setTimeout(() => resolve(data), ms));

export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  public details?: unknown;
  public requestId?: string;

  constructor(message: string, statusCode: number, code = 'API_ERROR', details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function fetchApi<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      credentials: 'include', // Ensure session cookies are sent with every request
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(fetchOptions.body != null ? { 'Content-Type': 'application/json' } : {}),
        // The API lives on another origin, so tell it which club's site this is.
        ...(typeof window !== 'undefined' ? { 'X-Tenant-Host': window.location.host } : {}),
        ...fetchOptions.headers,
      },
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (!response.ok) {
      // The session ended server-side (expired, revoked, signed out elsewhere). Tell the AuthProvider so
      // the UI stops presenting a signed-in user whose every request is rejected. Credential endpoints
      // are excluded: a 401 there just means the details were wrong.
      if (response.status === 401 && typeof window !== 'undefined' && !/\/api\/v1\/auth\//.test(url)) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
      if (isJson) {
        const errorData = await response.json();
        throw new ApiError(
          errorData.message || `Request failed with status ${response.status}`,
          response.status,
          errorData.code || 'HTTP_ERROR',
          errorData.details,
          errorData.requestId
        );
      }
      const text = await response.text();
      throw new ApiError(text || `Request failed with status ${response.status}`, response.status);
    }

    if (isJson) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) {
      throw err;
    }
    if ((err as { name?: string }).name === 'AbortError') {
      throw new ApiError(`Request to ${endpoint} timed out after ${timeoutMs}ms`, 408, 'REQUEST_TIMEOUT');
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Network error communicating with API: ${message}`, 503, 'NETWORK_ERROR');
  }
}

/**
 * Typed API Client
 */
async function mockBookingAction(data: CreateBookingRequest, social: boolean): Promise<Booking | JoinSocialResponse> {
  await mock(null, 400);
  try { return mockCreateBooking(data, social); }
  catch (error) {
    if (error instanceof MockBookingError) throw new ApiError(error.message, error.statusCode, error.code);
    throw error;
  }
}

async function mockBookingCall<T>(run: () => T): Promise<T> {
  await mock(null, 300);
  try { return run(); }
  catch (error) {
    if (error instanceof MockBookingError) throw new ApiError(error.message, error.statusCode, error.code);
    throw error;
  }
}
const queryString = (params: object) => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined) as [string, string][]).toString();

export const api = {
  courts: {
    availability: (params: AvailabilityQuery): Promise<Availability> => USE_MOCKS
      ? mock(mockAvailability(params)) : fetchApi<Availability>(`/api/v1/courts/availability?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined) as [string, string][])}`),
  },
  bookings: {
    create: (data: CreateBookingRequest): Promise<Booking> => USE_MOCKS
      ? mockBookingAction(data, false) : fetchApi<Booking>('/api/v1/bookings', { method: 'POST', body: JSON.stringify(data) }),
    joinSocial: (data: JoinSocialRequest): Promise<JoinSocialResponse> => USE_MOCKS
      ? mockBookingAction(data, true) as Promise<JoinSocialResponse> : fetchApi<JoinSocialResponse>('/api/v1/bookings/social/join', { method: 'POST', body: JSON.stringify(data) }),
    mine: (params: Partial<MyBookingsQuery> = {}): Promise<BookingPage> => USE_MOCKS
      ? mockBookingCall(() => mockListBookings({ scope: params.scope ?? 'upcoming', memberId: mockMyMember().id })) : fetchApi<BookingPage>(`/api/v1/me/bookings?${queryString(params)}`),
    list: (params: Partial<BookingListQuery> = {}): Promise<BookingPage> => USE_MOCKS
      ? mockBookingCall(() => mockListBookings({ date: params.date })) : fetchApi<BookingPage>(`/api/v1/bookings?${queryString(params)}`),
    cancel: (id: string, data: CancelBookingRequest = {}): Promise<CancelBookingResponse> => USE_MOCKS
      ? mockBookingCall(() => mockCancelBooking(id, data.override)) : fetchApi<CancelBookingResponse>(`/api/v1/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify(data) }),
  },
  plans: {
    list: (): Promise<Plan[]> => USE_MOCKS ? mock(plansMock) : fetchApi<Plan[]>('/api/v1/plans'),
  },
  public: {
    plans: (): Promise<Plan[]> => USE_MOCKS ? mock(plansMock) : fetchApi<Plan[]>('/api/v1/public/plans'),
    club: (): Promise<PublicClub> => USE_MOCKS ? mock(clubMock) : fetchApi<PublicClub>('/api/v1/public/club'),
    availability: (params: Pick<AvailabilityQuery, 'date' | 'courtTypeId'>): Promise<Availability> => USE_MOCKS
      ? mock(mockAvailability(params)) : fetchApi<Availability>(`/api/v1/public/availability?${queryString(params)}`),
    createTrialBooking: (data: CreateTrialBookingRequest): Promise<CreateTrialBookingResponse> => USE_MOCKS
      ? mockBookingCall(() => mockCreateTrial(data)) : fetchApi<CreateTrialBookingResponse>('/api/v1/public/trial-bookings', { method: 'POST', body: JSON.stringify(data) }),
    createEnquiry: (data: CreateEnquiryRequest): Promise<CreateEnquiryResponse> => USE_MOCKS
      ? mock(enquiryMock, 500)
      : fetchApi<CreateEnquiryResponse>('/api/v1/public/enquiries', { method: 'POST', body: JSON.stringify(data) }),
  },
  members: {
    lookup: async (q: string): Promise<MemberLookupItem[]> => {
      if (!USE_MOCKS) return fetchApi<MemberLookupItem[]>(`/api/v1/members/lookup?${new URLSearchParams({ q })}`);
      const page = listMockMembers({ q, limit: 8 });
      return mock(page.data.map((member) => ({ id: member.id, fullName: member.fullName, memberCode: member.memberCode, phone: member.phone,
        planCode: member.membership?.plan.code ?? null, expiryState: member.membership?.expiryState ?? 'NONE',
        shopDiscountPct: member.entitlements.shopDiscountPct, barDiscountPct: member.entitlements.barDiscountPct })));
    },
    me: (): Promise<Member> => USE_MOCKS ? mock(mockMyMember()) : fetchApi<Member>('/api/v1/me/member'),
    get: async (id: string): Promise<Member> => {
      if (!USE_MOCKS) return fetchApi<Member>(`/api/v1/members/${encodeURIComponent(id)}`);
      const member = await mock(mockGetMember(id));
      if (!member) throw new ApiError('Member not found', 404, 'MEMBER_NOT_FOUND');
      return member;
    },
    create: async (data: CreateMemberRequest): Promise<CreateMemberResponse> => {
      if (!USE_MOCKS) return fetchApi<CreateMemberResponse>('/api/v1/members', { method: 'POST', body: JSON.stringify(data) });
      await mock(null, 500);
      const response = mockCreateMember(data);
      if (!response) throw new ApiError('Plan not found', 404, 'PLAN_NOT_FOUND');
      return response;
    },
    timeline: async (id: string) => {
      if (!USE_MOCKS) return fetchApi<ReturnType<typeof mockMemberTimeline>>(`/api/v1/members/${encodeURIComponent(id)}/timeline`);
      if (!mockGetMember(id)) throw new ApiError('Member not found', 404, 'MEMBER_NOT_FOUND');
      return mock(mockMemberTimeline(id));
    },
    checkin: async (id: string): Promise<CheckinResponse> => {
      if (!USE_MOCKS) return fetchApi<CheckinResponse>(`/api/v1/members/${encodeURIComponent(id)}/checkin`, { method: 'POST', body: '{}' });
      await mock(null);
      const response = mockCheckinMember(id);
      if (!response) throw new ApiError('Member not found', 404, 'MEMBER_NOT_FOUND');
      return response;
    },
    renew: async (id: string, data: RenewMembershipRequest): Promise<RenewMembershipResponse> => {
      if (!USE_MOCKS) return fetchApi<RenewMembershipResponse>(`/api/v1/members/${encodeURIComponent(id)}/membership/renew`, { method: 'POST', body: JSON.stringify(data) });
      await mock(null, 500);
      const response = mockRenewMember(id, data);
      if (!response) throw new ApiError('Membership not found', 404, 'MEMBERSHIP_NOT_FOUND');
      return response;
    },
    list: (params: Partial<MemberListQuery> = {}): Promise<MemberPage> => {
      if (USE_MOCKS) return mock(listMockMembers(params));
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') query.set(key, String(value));
      }
      return fetchApi<MemberPage>(`/api/v1/members${query.size ? `?${query}` : ''}`);
    },
  },
  health: {
    getSummary: () => fetchApi<HealthSummaryResponse>('/health'),
    getLiveness: () => fetchApi<{ status: string; timestamp: string }>('/health/live'),
    getReadiness: () => fetchApi<ReadinessResponse>('/health/ready'),
  },
  system: {
    getInfo: () =>
      fetchApi<{
        name: string;
        version: string;
        environment: string;
        nodeVersion: string;
        uptime: number;
        timestamp: string;
        features: Record<string, boolean>;
      }>('/api/v1/system/info'),
  },
  auth: {
    signup: (data: SignupRequest) =>
      fetchApi<SessionResponse>('/api/v1/auth/signup', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    login: (data: LoginRequest) =>
      fetchApi<SessionResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    logout: () =>
      fetchApi<{ success: boolean; message: string }>('/api/v1/auth/logout', {
        method: 'POST',
      }),
    getSession: () => fetchApi<SessionResponse>('/api/v1/auth/session'),
  },
  profile: {
    get: () => fetchApi<AuthUser>('/api/v1/profile'),
    update: (data: UpdateProfile) =>
      fetchApi<AuthUser>('/api/v1/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    changePassword: (data: ChangePassword) =>
      fetchApi<{ success: boolean; message: string }>('/api/v1/profile/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  iam: {
    // Users
    listUsers: (query: Partial<UserListQuery> = {}) => {
      const params = new URLSearchParams();
      if (query.page) params.set('page', String(query.page));
      if (query.limit) params.set('limit', String(query.limit));
      if (query.search) params.set('search', query.search);
      if (query.status) params.set('status', query.status);
      if (query.identityType) params.set('identityType', query.identityType);
      const qs = params.toString();
      return fetchApi<{
        data: AuthUser[];
        meta: {
          page: number;
          limit: number;
          totalItems: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPrevPage: boolean;
        };
      }>(`/api/v1/iam/users${qs ? `?${qs}` : ''}`);
    },
    getUser: (id: string) =>
      fetchApi<
        AuthUser & {
          roles: Role[];
          groups: Group[];
          directPolicies: Policy[];
        }
      >(`/api/v1/iam/users/${id}`),
    updateUserStatus: (id: string, data: UpdateUserStatus) =>
      fetchApi<AuthUser>(`/api/v1/iam/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    getUserPermissions: (id: string) =>
      fetchApi<EffectivePermissionsResponse>(`/api/v1/iam/users/${id}/permissions`),
    assignRole: (userId: string, roleId: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/users/${userId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ roleId }),
      }),
    removeRole: (userId: string, roleId: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/users/${userId}/roles/${roleId}`, {
        method: 'DELETE',
      }),
    addUserToGroup: (userId: string, groupId: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/users/${userId}/groups`, {
        method: 'POST',
        body: JSON.stringify({ groupId }),
      }),
    removeUserFromGroup: (userId: string, groupId: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/users/${userId}/groups/${groupId}`, {
        method: 'DELETE',
      }),
    attachDirectPolicy: (userId: string, policyId: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/users/${userId}/policies`, {
        method: 'POST',
        body: JSON.stringify({ policyId }),
      }),
    detachDirectPolicy: (userId: string, policyId: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/users/${userId}/policies/${policyId}`, {
        method: 'DELETE',
      }),

    // Roles
    listRoles: () => fetchApi<Role[]>('/api/v1/iam/roles'),
    getRole: (id: string) => fetchApi<Role & { policies: Policy[] }>(`/api/v1/iam/roles/${id}`),
    createRole: (data: CreateRole) =>
      fetchApi<Role>('/api/v1/iam/roles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateRole: (id: string, data: UpdateRole) =>
      fetchApi<Role>(`/api/v1/iam/roles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteRole: (id: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/roles/${id}`, {
        method: 'DELETE',
      }),

    // Groups
    listGroups: () => fetchApi<Group[]>('/api/v1/iam/groups'),
    getGroup: (id: string) =>
      fetchApi<Group & { memberCount: number; policies: Policy[] }>(`/api/v1/iam/groups/${id}`),
    createGroup: (data: CreateGroup) =>
      fetchApi<Group>('/api/v1/iam/groups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateGroup: (id: string, data: UpdateGroup) =>
      fetchApi<Group>(`/api/v1/iam/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteGroup: (id: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/groups/${id}`, {
        method: 'DELETE',
      }),

    // Policies
    listPolicies: () => fetchApi<Policy[]>('/api/v1/iam/policies'),
    getPolicy: (id: string) => fetchApi<Policy>(`/api/v1/iam/policies/${id}`),
    createPolicy: (data: CreatePolicy) =>
      fetchApi<Policy>('/api/v1/iam/policies', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updatePolicy: (id: string, data: UpdatePolicy) =>
      fetchApi<Policy>(`/api/v1/iam/policies/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deletePolicy: (id: string) =>
      fetchApi<{ success: boolean; message: string }>(`/api/v1/iam/policies/${id}`, {
        method: 'DELETE',
      }),

    // Permissions
    listPermissions: () => fetchApi<Permission[]>('/api/v1/iam/permissions'),
  },
};
