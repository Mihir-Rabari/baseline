import type { ReadinessResponse, HealthSummaryResponse } from '@packages/shared';
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
} from '@packages/validation';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (!response.ok) {
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
export const api = {
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
