import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  UserListQuerySchema,
  UpdateUserStatusSchema,
  CreateRoleSchema,
  UpdateRoleSchema,
  CreateGroupSchema,
  UpdateGroupSchema,
  CreatePolicySchema,
  UpdatePolicySchema,
  AttachPolicySchema,
  AssignRoleSchema,
  HttpErrorResponseSchema,
  EffectivePermissionsResponseSchema,
  UserResponseSchema,
  UserDetailResponseSchema,
  RoleResponseSchema,
  RoleDetailResponseSchema,
  GroupResponseSchema,
  GroupDetailResponseSchema,
  PolicyResponseSchema,
  UuidSchema,
  type UserListQuery,
  type UpdateUserStatus,
  type CreateRole,
  type UpdateRole,
  type CreateGroup,
  type UpdateGroup,
  type CreatePolicy,
  type UpdatePolicy,
  type AttachPolicy,
  type AssignRole,
} from '@packages/validation';
import { requirePermission } from '@packages/iam';

export const iamRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // ===========================================================================
  // USERS MANAGEMENT
  // ===========================================================================

  // GET /api/v1/iam/users
  fastify.get(
    '/iam/users',
    {
      preHandler: [requirePermission('users:read')],
      schema: {
        description: 'List user accounts with pagination and filtering',
        tags: ['IAM - Users'],
        querystring: UserListQuerySchema,
        response: {
          200: z.object({
            // Shares UserResponseSchema with the detail endpoints so the two can never
            // drift, and so timestamps serialize as ISO strings rather than Date objects.
            data: z.array(UserResponseSchema),
            meta: z.object({
              page: z.number(),
              limit: z.number(),
              totalItems: z.number(),
              totalPages: z.number(),
              hasNextPage: z.boolean(),
              hasPrevPage: z.boolean(),
            }),
          }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query as UserListQuery;
      const result = await fastify.iamService.listUsers(query);
      return reply.status(200).send(result);
    }
  );

  // GET /api/v1/iam/users/:id
  fastify.get(
    '/iam/users/:id',
    {
      preHandler: [requirePermission('users:read')],
      schema: {
        description: 'Get user details by ID including direct policies, roles, and groups',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: UserDetailResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await fastify.iamService.getUserById(id);
      if (!user) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `User ${id} not found`,
          code: 'USER_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(user);
    }
  );

  // PATCH /api/v1/iam/users/:id/status
  fastify.patch(
    '/iam/users/:id/status',
    {
      preHandler: [requirePermission('users:update')],
      schema: {
        description: 'Update user account status (ACTIVE, SUSPENDED, DISABLED)',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema }),
        body: UpdateUserStatusSchema,
        response: {
          200: UserResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as UpdateUserStatus;

      const updated = await fastify.iamService.updateUserStatus(
        id,
        status,
        request.user?.id || 'system'
      );

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `User ${id} not found`,
          code: 'USER_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      // If suspended or disabled, revoke all active sessions immediately
      if (status === 'SUSPENDED' || status === 'DISABLED') {
        await fastify.sessionManager.revokeAllUserSessions(id);
      }

      return reply.status(200).send(updated);
    }
  );

  // GET /api/v1/iam/users/:id/permissions
  fastify.get(
    '/iam/users/:id/permissions',
    {
      preHandler: [requirePermission('users:read')],
      schema: {
        description: 'Inspect live effective permissions calculation for a specific user',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: EffectivePermissionsResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await fastify.iamService.getEffectivePermissions(id);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err instanceof Error ? err.message : 'User not found',
          code: 'USER_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // User Role Assignments
  fastify.post(
    '/iam/users/:id/roles',
    {
      preHandler: [requirePermission('roles:update')],
      schema: {
        description: 'Assign a role to a user',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema }),
        body: AssignRoleSchema,
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as AssignRole;
      await fastify.iamService.assignRoleToUser(id, body.roleId, request.user?.id);
      return reply.status(200).send({ success: true, message: 'Role assigned successfully' });
    }
  );

  fastify.delete(
    '/iam/users/:id/roles/:roleId',
    {
      preHandler: [requirePermission('roles:update')],
      schema: {
        description: 'Remove a role from a user',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema, roleId: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id, roleId } = request.params as { id: string; roleId: string };
      await fastify.iamService.removeRoleFromUser(id, roleId, request.user?.id);
      return reply.status(200).send({ success: true, message: 'Role removed successfully' });
    }
  );

  // User Group Memberships
  fastify.post(
    '/iam/users/:id/groups',
    {
      preHandler: [requirePermission('groups:update')],
      schema: {
        description: 'Add user to a group',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema }),
        body: z.object({ groupId: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { groupId } = request.body as { groupId: string };
      await fastify.iamService.addUserToGroup(id, groupId, request.user?.id);
      return reply.status(200).send({ success: true, message: 'User added to group' });
    }
  );

  fastify.delete(
    '/iam/users/:id/groups/:groupId',
    {
      preHandler: [requirePermission('groups:update')],
      schema: {
        description: 'Remove user from a group',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema, groupId: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id, groupId } = request.params as { id: string; groupId: string };
      await fastify.iamService.removeUserFromGroup(id, groupId, request.user?.id);
      return reply.status(200).send({ success: true, message: 'User removed from group' });
    }
  );

  // Direct User Policies
  fastify.post(
    '/iam/users/:id/policies',
    {
      preHandler: [requirePermission('policies:update')],
      schema: {
        description: 'Attach policy directly to a user',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema }),
        body: AttachPolicySchema,
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as AttachPolicy;
      await fastify.iamService.attachPolicyToUser(id, body.policyId, request.user?.id);
      return reply.status(200).send({ success: true, message: 'Policy attached directly to user' });
    }
  );

  fastify.delete(
    '/iam/users/:id/policies/:policyId',
    {
      preHandler: [requirePermission('policies:update')],
      schema: {
        description: 'Detach direct policy from a user',
        tags: ['IAM - Users'],
        params: z.object({ id: UuidSchema, policyId: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id, policyId } = request.params as { id: string; policyId: string };
      await fastify.iamService.detachPolicyFromUser(id, policyId, request.user?.id);
      return reply.status(200).send({ success: true, message: 'Policy detached from user' });
    }
  );

  // ===========================================================================
  // ROLES MANAGEMENT
  // ===========================================================================

  // GET /api/v1/iam/roles
  fastify.get(
    '/iam/roles',
    {
      preHandler: [requirePermission('roles:read')],
      schema: {
        description: 'List all IAM roles',
        tags: ['IAM - Roles'],
        response: {
          200: z.array(RoleResponseSchema),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const roleList = await fastify.iamService.listRoles();
      return reply.status(200).send(roleList);
    }
  );

  // POST /api/v1/iam/roles
  fastify.post(
    '/iam/roles',
    {
      preHandler: [requirePermission('roles:create')],
      schema: {
        description: 'Create a new IAM role',
        tags: ['IAM - Roles'],
        body: CreateRoleSchema,
        response: {
          201: RoleResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateRole;
      const created = await fastify.iamService.createRole(body, request.user?.id);
      return reply.status(201).send(created);
    }
  );

  // GET /api/v1/iam/roles/:id
  fastify.get(
    '/iam/roles/:id',
    {
      preHandler: [requirePermission('roles:read')],
      schema: {
        description: 'Get role details and attached policies',
        tags: ['IAM - Roles'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: RoleDetailResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const role = await fastify.iamService.getRoleById(id);
      if (!role) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Role not found',
          code: 'ROLE_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(role);
    }
  );

  // PUT /api/v1/iam/roles/:id
  fastify.put(
    '/iam/roles/:id',
    {
      preHandler: [requirePermission('roles:update')],
      schema: {
        description: 'Update role metadata or attached policies',
        tags: ['IAM - Roles'],
        params: z.object({ id: UuidSchema }),
        body: UpdateRoleSchema,
        response: {
          200: RoleDetailResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateRole;
      const updated = await fastify.iamService.updateRole(id, body, request.user?.id);
      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Role not found',
          code: 'ROLE_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(updated);
    }
  );

  // DELETE /api/v1/iam/roles/:id
  fastify.delete(
    '/iam/roles/:id',
    {
      preHandler: [requirePermission('roles:delete')],
      schema: {
        description: 'Delete an IAM role',
        tags: ['IAM - Roles'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await fastify.iamService.deleteRole(id, request.user?.id);
      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Role not found',
          code: 'ROLE_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send({ success: true, message: 'Role deleted successfully' });
    }
  );

  // ===========================================================================
  // GROUPS MANAGEMENT
  // ===========================================================================

  // GET /api/v1/iam/groups
  fastify.get(
    '/iam/groups',
    {
      preHandler: [requirePermission('groups:read')],
      schema: {
        description: 'List all IAM groups',
        tags: ['IAM - Groups'],
        response: {
          200: z.array(GroupResponseSchema),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const groupList = await fastify.iamService.listGroups();
      return reply.status(200).send(groupList);
    }
  );

  // POST /api/v1/iam/groups
  fastify.post(
    '/iam/groups',
    {
      preHandler: [requirePermission('groups:create')],
      schema: {
        description: 'Create a new IAM group',
        tags: ['IAM - Groups'],
        body: CreateGroupSchema,
        response: {
          201: GroupResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateGroup;
      const created = await fastify.iamService.createGroup(body, request.user?.id);
      return reply.status(201).send(created);
    }
  );

  // GET /api/v1/iam/groups/:id
  fastify.get(
    '/iam/groups/:id',
    {
      preHandler: [requirePermission('groups:read')],
      schema: {
        description: 'Get group details, member count, and attached policies',
        tags: ['IAM - Groups'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: GroupDetailResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const group = await fastify.iamService.getGroupById(id);
      if (!group) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Group not found',
          code: 'GROUP_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(group);
    }
  );

  // PUT /api/v1/iam/groups/:id
  fastify.put(
    '/iam/groups/:id',
    {
      preHandler: [requirePermission('groups:update')],
      schema: {
        description: 'Update group metadata or policies',
        tags: ['IAM - Groups'],
        params: z.object({ id: UuidSchema }),
        body: UpdateGroupSchema,
        response: {
          200: GroupDetailResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateGroup;
      const updated = await fastify.iamService.updateGroup(id, body, request.user?.id);
      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Group not found',
          code: 'GROUP_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(updated);
    }
  );

  // DELETE /api/v1/iam/groups/:id
  fastify.delete(
    '/iam/groups/:id',
    {
      preHandler: [requirePermission('groups:delete')],
      schema: {
        description: 'Delete an IAM group',
        tags: ['IAM - Groups'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await fastify.iamService.deleteGroup(id, request.user?.id);
      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Group not found',
          code: 'GROUP_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send({ success: true, message: 'Group deleted successfully' });
    }
  );

  // ===========================================================================
  // POLICIES MANAGEMENT
  // ===========================================================================

  // GET /api/v1/iam/policies
  fastify.get(
    '/iam/policies',
    {
      preHandler: [requirePermission('policies:read')],
      schema: {
        description: 'List all IAM policies',
        tags: ['IAM - Policies'],
        response: {
          200: z.array(PolicyResponseSchema),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const policyList = await fastify.iamService.listPolicies();
      return reply.status(200).send(policyList);
    }
  );

  // POST /api/v1/iam/policies
  fastify.post(
    '/iam/policies',
    {
      preHandler: [requirePermission('policies:create')],
      schema: {
        description: 'Create a new IAM policy with statements',
        tags: ['IAM - Policies'],
        body: CreatePolicySchema,
        response: {
          201: PolicyResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as CreatePolicy;
      const created = await fastify.iamService.createPolicy(body, request.user?.id);
      return reply.status(201).send(created);
    }
  );

  // GET /api/v1/iam/policies/:id
  fastify.get(
    '/iam/policies/:id',
    {
      preHandler: [requirePermission('policies:read')],
      schema: {
        description: 'Get policy details and full statements list',
        tags: ['IAM - Policies'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: PolicyResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const policy = await fastify.iamService.getPolicyById(id);
      if (!policy) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Policy not found',
          code: 'POLICY_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(policy);
    }
  );

  // PUT /api/v1/iam/policies/:id
  fastify.put(
    '/iam/policies/:id',
    {
      preHandler: [requirePermission('policies:update')],
      schema: {
        description: 'Update policy and replace statements',
        tags: ['IAM - Policies'],
        params: z.object({ id: UuidSchema }),
        body: UpdatePolicySchema,
        response: {
          200: PolicyResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdatePolicy;
      const updated = await fastify.iamService.updatePolicy(id, body, request.user?.id);
      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Policy not found',
          code: 'POLICY_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(updated);
    }
  );

  // DELETE /api/v1/iam/policies/:id
  fastify.delete(
    '/iam/policies/:id',
    {
      preHandler: [requirePermission('policies:delete')],
      schema: {
        description: 'Delete an IAM policy',
        tags: ['IAM - Policies'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await fastify.iamService.deletePolicy(id, request.user?.id);
      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Policy not found',
          code: 'POLICY_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send({ success: true, message: 'Policy deleted successfully' });
    }
  );

  // ===========================================================================
  // PERMISSIONS CATALOG BROWSER
  // ===========================================================================

  // GET /api/v1/iam/permissions
  fastify.get(
    '/iam/permissions',
    {
      preHandler: [requirePermission('permissions:read')],
      schema: {
        description: 'Browse registered system permissions catalog',
        tags: ['IAM - Permissions'],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              namespace: z.string(),
              action: z.string(),
              description: z.string().optional(),
              isSystem: z.boolean().optional(),
            })
          ),
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const perms = await fastify.iamService.listPermissions();
      return reply.status(200).send(perms);
    }
  );
};
