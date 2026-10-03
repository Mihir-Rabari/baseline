import { z } from 'zod';
import {
  NonEmptyStringSchema,
  IsoDateTimeOutSchema,
  NullableIsoDateTimeOutSchema,
} from './common.js';
import { PaginationQuerySchema } from './pagination.js';
import { UserStatusEnum, IdentityTypeEnum } from './auth.js';

// Permission schemas
export const PermissionSchema = z.object({
  id: z.string().min(1),
  namespace: z.string().min(1),
  action: z.string().min(1),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type Permission = z.infer<typeof PermissionSchema>;

// Policy Statement schemas
export const PolicyStatementEffectEnum = z.enum(['allow', 'deny']);
export type PolicyStatementEffect = z.infer<typeof PolicyStatementEffectEnum>;

// Canonical set of condition operators understood by the policy engine
// (`packages/iam/src/policy/policy-engine.ts`). This lives in `@packages/validation`
// rather than `@packages/iam` because validation has no dependency on iam (and must not
// gain one), while iam already depends on validation — so iam imports this constant
// rather than the other way around. Keeping a single source of truth means a policy
// carrying an operator the engine doesn't understand is rejected at write time instead
// of silently denying everything it touches at evaluation time.
export const SUPPORTED_CONDITION_OPERATORS = [
  'StringEquals',
  'StringNotEquals',
  'Bool',
  'OwnerEquals',
] as const;
export type ConditionOperator = (typeof SUPPORTED_CONDITION_OPERATORS)[number];

// A policy condition looks like { "StringEquals": { "some:key": "value" } } — the outer
// keys are the operator names and must be restricted to the supported set. z.record()
// can't express a restricted key set directly, so the outer keys are validated with
// superRefine while the inner operand shape stays a free-form record.
const ConditionOperandSchema = z.record(z.unknown());

export const PolicyConditionsSchema = z
  .record(ConditionOperandSchema)
  .superRefine((conditions, ctx) => {
    for (const operator of Object.keys(conditions)) {
      if (!(SUPPORTED_CONDITION_OPERATORS as readonly string[]).includes(operator)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [operator],
          message: `Unsupported condition operator "${operator}". Supported operators: ${SUPPORTED_CONDITION_OPERATORS.join(', ')}.`,
        });
      }
    }
  });

export const PolicyStatementSchema = z.object({
  id: z.string().uuid().optional(),
  effect: PolicyStatementEffectEnum,
  actions: z.array(z.string().min(1)).min(1, 'At least one action is required'),
  resources: z.array(z.string()).default(['*']),
  // Nullable as well as optional: the column is stored as nullable jsonb, so a statement
  // read back from the database carries `null` rather than `undefined`.
  conditions: PolicyConditionsSchema.nullable().optional(),
});
export type PolicyStatement = z.infer<typeof PolicyStatementSchema>;

// Policy schemas
export const PolicySchema = z.object({
  id: z.string().uuid(),
  name: NonEmptyStringSchema,
  description: z.string().nullable().optional(),
  isSystem: z.boolean().default(false),
  statements: z.array(PolicyStatementSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const CreatePolicySchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  statements: z.array(PolicyStatementSchema).min(1, 'At least one statement is required'),
});
export type CreatePolicy = z.infer<typeof CreatePolicySchema>;

export const UpdatePolicySchema = z.object({
  name: NonEmptyStringSchema.optional(),
  description: z.string().optional(),
  statements: z.array(PolicyStatementSchema).optional(),
});
export type UpdatePolicy = z.infer<typeof UpdatePolicySchema>;

// Role schemas
export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: NonEmptyStringSchema,
  description: z.string().nullable().optional(),
  isSystem: z.boolean().default(false),
  policies: z.array(PolicySchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Role = z.infer<typeof RoleSchema>;

export const CreateRoleSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  policyIds: z.array(z.string().uuid()).optional(),
});
export type CreateRole = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: NonEmptyStringSchema.optional(),
  description: z.string().optional(),
  policyIds: z.array(z.string().uuid()).optional(),
});
export type UpdateRole = z.infer<typeof UpdateRoleSchema>;

// Group schemas
export const GroupSchema = z.object({
  id: z.string().uuid(),
  name: NonEmptyStringSchema,
  description: z.string().nullable().optional(),
  isSystem: z.boolean().default(false),
  memberCount: z.number().int().min(0).optional(),
  policies: z.array(PolicySchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Group = z.infer<typeof GroupSchema>;

export const CreateGroupSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  policyIds: z.array(z.string().uuid()).optional(),
});
export type CreateGroup = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z.object({
  name: NonEmptyStringSchema.optional(),
  description: z.string().optional(),
  policyIds: z.array(z.string().uuid()).optional(),
});
export type UpdateGroup = z.infer<typeof UpdateGroupSchema>;

// Assignment schemas
export const AttachPolicySchema = z.object({
  policyId: z.string().uuid(),
});
export type AttachPolicy = z.infer<typeof AttachPolicySchema>;

export const AssignRoleSchema = z.object({
  roleId: z.string().uuid(),
});
export type AssignRole = z.infer<typeof AssignRoleSchema>;

export const AddUserToGroupSchema = z.object({
  userId: z.string().uuid(),
});
export type AddUserToGroup = z.infer<typeof AddUserToGroupSchema>;

export const UpdateUserStatusSchema = z.object({
  status: UserStatusEnum,
});
export type UpdateUserStatus = z.infer<typeof UpdateUserStatusSchema>;

// Query and listing schemas
export const UserListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  status: UserStatusEnum.optional(),
  identityType: IdentityTypeEnum.optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

// ---------------------------------------------------------------------------
// RESPONSE SCHEMAS
//
// These describe what the API actually sends back, as opposed to the schemas above
// which describe request payloads and canonical domain shapes. They accept the `Date`
// objects Drizzle returns and emit ISO strings.
//
// Every IAM route declares one of these. Using `z.any()` instead would switch off
// Fastify's response serialization, which is what previously allowed a raw `users` row
// — `passwordHash` included — to reach the client.
// ---------------------------------------------------------------------------

const auditTimestamps = {
  createdAt: IsoDateTimeOutSchema,
  updatedAt: IsoDateTimeOutSchema,
};

export const RoleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().optional(),
  ...auditTimestamps,
});

export const GroupResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().optional(),
  memberCount: z.number().int().optional(),
  ...auditTimestamps,
});

export const PolicyResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().optional(),
  statements: z.array(PolicyStatementSchema).optional(),
  ...auditTimestamps,
});

/** A user as returned by the API. Deliberately has no `passwordHash` field. */
export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: UserStatusEnum,
  identityType: IdentityTypeEnum,
  lastLoginAt: NullableIsoDateTimeOutSchema.optional(),
  ...auditTimestamps,
});

export const UserDetailResponseSchema = UserResponseSchema.extend({
  roles: z.array(RoleResponseSchema).optional(),
  groups: z.array(GroupResponseSchema).optional(),
  directPolicies: z.array(PolicyResponseSchema).optional(),
});

export const RoleDetailResponseSchema = RoleResponseSchema.extend({
  policies: z.array(PolicyResponseSchema).optional(),
});

export const GroupDetailResponseSchema = GroupResponseSchema.extend({
  policies: z.array(PolicyResponseSchema).optional(),
  members: z.array(UserResponseSchema).optional(),
});

// Effective permissions response
export const EffectivePermissionsResponseSchema = z.object({
  identity: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    identityType: IdentityTypeEnum,
    status: UserStatusEnum,
  }),
  directPolicies: z.array(PolicySchema),
  roles: z.array(RoleSchema),
  groups: z.array(GroupSchema),
  allPolicies: z.array(PolicySchema),
  effectivePermissions: z.array(z.string()),
});
export type EffectivePermissionsResponse = z.infer<typeof EffectivePermissionsResponseSchema>;
