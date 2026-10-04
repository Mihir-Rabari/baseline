import { pgTable, varchar, text, timestamp, jsonb, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { tenantId } from './_tenant.js';

/**
 * Foundational system configuration and metadata key-value storage.
 * Used for storing installation state, schema versions, and global flags.
 */
export const systemSettings = pgTable(
  'system_settings',
  {
    tenantId: tenantId(),
    key: varchar('key', { length: 128 }).notNull(),
    value: jsonb('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })]
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;

/**
 * Foundational system event & audit log table.
 * Used to record critical infrastructure events, migration executions, and system health benchmarks.
 */
export const systemAuditLogs = pgTable('system_audit_logs', {
  tenantId: tenantId(),
  id: uuid('id').defaultRandom().primaryKey(),
  action: varchar('action', { length: 128 }).notNull(),
  actor: varchar('actor', { length: 128 }).notNull().default('system'),
  details: jsonb('details'),
  status: varchar('status', { length: 32 }).notNull().default('success'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SystemAuditLog = typeof systemAuditLogs.$inferSelect;
export type NewSystemAuditLog = typeof systemAuditLogs.$inferInsert;
