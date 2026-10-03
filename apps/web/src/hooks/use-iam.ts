'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type {
  UserListQuery,
  UpdateUserStatus,
  CreateRole,
  UpdateRole,
  CreateGroup,
  UpdateGroup,
  CreatePolicy,
  UpdatePolicy,
} from '@packages/validation';

// -----------------------------------------------------------------------------
// USERS HOOKS
// -----------------------------------------------------------------------------
export function useIamUsers(query: Partial<UserListQuery> = {}) {
  return useQuery({
    queryKey: ['iam', 'users', query],
    queryFn: () => api.iam.listUsers(query),
  });
}

export function useIamUser(id: string) {
  return useQuery({
    queryKey: ['iam', 'user', id],
    queryFn: () => api.iam.getUser(id),
    enabled: !!id,
  });
}

export function useIamUserPermissions(id: string) {
  return useQuery({
    queryKey: ['iam', 'user', id, 'permissions'],
    queryFn: () => api.iam.getUserPermissions(id),
    enabled: !!id,
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserStatus }) =>
      api.iam.updateUserStatus(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.id] });
    },
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api.iam.assignRole(userId, roleId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.userId] });
      queryClient.invalidateQueries({
        queryKey: ['iam', 'user', variables.userId, 'permissions'],
      });
    },
  });
}

export function useRemoveRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api.iam.removeRole(userId, roleId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.userId] });
      queryClient.invalidateQueries({
        queryKey: ['iam', 'user', variables.userId, 'permissions'],
      });
    },
  });
}

export function useAddUserToGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, groupId }: { userId: string; groupId: string }) =>
      api.iam.addUserToGroup(userId, groupId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.userId] });
      queryClient.invalidateQueries({
        queryKey: ['iam', 'user', variables.userId, 'permissions'],
      });
      queryClient.invalidateQueries({ queryKey: ['iam', 'group', variables.groupId] });
    },
  });
}

export function useRemoveUserFromGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, groupId }: { userId: string; groupId: string }) =>
      api.iam.removeUserFromGroup(userId, groupId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.userId] });
      queryClient.invalidateQueries({
        queryKey: ['iam', 'user', variables.userId, 'permissions'],
      });
      queryClient.invalidateQueries({ queryKey: ['iam', 'group', variables.groupId] });
    },
  });
}

export function useAttachDirectPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, policyId }: { userId: string; policyId: string }) =>
      api.iam.attachDirectPolicy(userId, policyId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.userId] });
      queryClient.invalidateQueries({
        queryKey: ['iam', 'user', variables.userId, 'permissions'],
      });
    },
  });
}

export function useDetachDirectPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, policyId }: { userId: string; policyId: string }) =>
      api.iam.detachDirectPolicy(userId, policyId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'user', variables.userId] });
      queryClient.invalidateQueries({
        queryKey: ['iam', 'user', variables.userId, 'permissions'],
      });
    },
  });
}

// -----------------------------------------------------------------------------
// ROLES HOOKS
// -----------------------------------------------------------------------------
export function useIamRoles() {
  return useQuery({
    queryKey: ['iam', 'roles'],
    queryFn: () => api.iam.listRoles(),
  });
}

export function useIamRole(id: string) {
  return useQuery({
    queryKey: ['iam', 'role', id],
    queryFn: () => api.iam.getRole(id),
    enabled: !!id,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRole) => api.iam.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'roles'] });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRole }) =>
      api.iam.updateRole(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'roles'] });
      queryClient.invalidateQueries({ queryKey: ['iam', 'role', variables.id] });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.iam.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'roles'] });
    },
  });
}

// -----------------------------------------------------------------------------
// GROUPS HOOKS
// -----------------------------------------------------------------------------
export function useIamGroups() {
  return useQuery({
    queryKey: ['iam', 'groups'],
    queryFn: () => api.iam.listGroups(),
  });
}

export function useIamGroup(id: string) {
  return useQuery({
    queryKey: ['iam', 'group', id],
    queryFn: () => api.iam.getGroup(id),
    enabled: !!id,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGroup) => api.iam.createGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'groups'] });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateGroup }) =>
      api.iam.updateGroup(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'groups'] });
      queryClient.invalidateQueries({ queryKey: ['iam', 'group', variables.id] });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.iam.deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'groups'] });
    },
  });
}

// -----------------------------------------------------------------------------
// POLICIES HOOKS
// -----------------------------------------------------------------------------
export function useIamPolicies() {
  return useQuery({
    queryKey: ['iam', 'policies'],
    queryFn: () => api.iam.listPolicies(),
  });
}

export function useIamPolicy(id: string) {
  return useQuery({
    queryKey: ['iam', 'policy', id],
    queryFn: () => api.iam.getPolicy(id),
    enabled: !!id,
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePolicy) => api.iam.createPolicy(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'policies'] });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePolicy }) =>
      api.iam.updatePolicy(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'policies'] });
      queryClient.invalidateQueries({ queryKey: ['iam', 'policy', variables.id] });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.iam.deletePolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iam', 'policies'] });
    },
  });
}

// -----------------------------------------------------------------------------
// PERMISSIONS HOOKS
// -----------------------------------------------------------------------------
export function useIamPermissions() {
  return useQuery({
    queryKey: ['iam', 'permissions'],
    queryFn: () => api.iam.listPermissions(),
  });
}
