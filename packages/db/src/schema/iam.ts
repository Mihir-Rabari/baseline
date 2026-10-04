import {
  pgTable,
  varchar,
  text,
  timestamp,
  uuid,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { tenantId } from './_tenant.js';

/**
 * Normalized system & domain permission registry.
 * Format: namespace:action (e.g. users:read, questions:update)
 */
export const permissions = pgTable('permissions', {
  id: varchar('id', { length: 128 }).primaryKey(), // e.g. "users:read"
  namespace: varchar('namespace', { length: 64 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PermissionRecord = typeof permissions.$inferSelect;
export type NewPermissionRecord = typeof permissions.$inferInsert;

/**
 * Policies define collections of allow/deny permission statements.
 */
export const policies = pgTable('policies', {
  tenantId: tenantId(),
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('uq_policies_tenant_name').on(t.tenantId, t.name)]);

export type PolicyRecord = typeof policies.$inferSelect;
export type NewPolicyRecord = typeof policies.$inferInsert;

/**
 * Policy Statements representing explicit Allow or Deny effects on action patterns.
 */
export const policyStatements = pgTable(
  'policy_statements',
  {
    tenantId: tenantId(),
    id: uuid('id').defaultRandom().primaryKey(),
    policyId: uuid('policy_id')
      .references(() => policies.id, { onDelete: 'cascade' })
      .notNull(),
    effect: varchar('effect', { length: 16 }).notNull().default('allow'), // 'allow' | 'deny'
    actions: jsonb('actions').$type<string[]>().notNull(),
    resources: jsonb('resources').$type<string[]>().default(['*']).notNull(),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_policy_statements_policy_id').on(table.policyId)]
);

export type PolicyStatementRecord = typeof policyStatements.$inferSelect;
export type NewPolicyStatementRecord = typeof policyStatements.$inferInsert;

/**
 * Named roles (bundles of policies).
 */
export const roles = pgTable('roles', {
  tenantId: tenantId(),
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('uq_roles_tenant_name').on(t.tenantId, t.name)]);

export type RoleRecord = typeof roles.$inferSelect;
export type NewRoleRecord = typeof roles.$inferInsert;

/**
 * Named groups (hierarchies of identities inheriting policies).
 */
export const groups = pgTable('groups', {
  tenantId: tenantId(),
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('uq_groups_tenant_name').on(t.tenantId, t.name)]);

export type GroupRecord = typeof groups.$inferSelect;
export type NewGroupRecord = typeof groups.$inferInsert;

/**
 * Junction: User to Role assignments
 */
export const userRoles = pgTable(
  'user_roles',
  {
    tenantId: tenantId(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roleId: uuid('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('idx_user_roles_user_id').on(table.userId),
    index('idx_user_roles_role_id').on(table.roleId),
  ]
);

/**
 * Junction: User to Group memberships
 */
export const userGroups = pgTable(
  'user_groups',
  {
    tenantId: tenantId(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: uuid('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.groupId] }),
    index('idx_user_groups_user_id').on(table.userId),
    index('idx_user_groups_group_id').on(table.groupId),
  ]
);

/**
 * Junction: Role to Policy attachments
 */
export const rolePolicies = pgTable(
  'role_policies',
  {
    tenantId: tenantId(),
    roleId: uuid('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    policyId: uuid('policy_id')
      .references(() => policies.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.policyId] }),
    index('idx_role_policies_role_id').on(table.roleId),
    index('idx_role_policies_policy_id').on(table.policyId),
  ]
);

/**
 * Junction: Group to Policy attachments
 */
export const groupPolicies = pgTable(
  'group_policies',
  {
    tenantId: tenantId(),
    groupId: uuid('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    policyId: uuid('policy_id')
      .references(() => policies.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.policyId] }),
    index('idx_group_policies_group_id').on(table.groupId),
    index('idx_group_policies_policy_id').on(table.policyId),
  ]
);

/**
 * Junction: Direct User to Policy attachments
 */
export const userPolicies = pgTable(
  'user_policies',
  {
    tenantId: tenantId(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    policyId: uuid('policy_id')
      .references(() => policies.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.policyId] }),
    index('idx_user_policies_user_id').on(table.userId),
    index('idx_user_policies_policy_id').on(table.policyId),
  ]
);
