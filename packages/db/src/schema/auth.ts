import { pgTable, varchar, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';

/**
 * Column-level unions for the `users` status and identity columns.
 *
 * These are stored as varchar rather than a Postgres enum so that adding a value does
 * not require a migration, but they are still a closed set at the type level. Declaring
 * them with `$type` means a query result flows into the API response schemas without a
 * cast, and a typo in a comparison is a compile error rather than a silent mismatch.
 */
export type UserStatusColumn = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type IdentityTypeColumn = 'ROOT' | 'EXTERNAL_USER';

/**
 * Users table storing primary identity records.
 * Supports ROOT (system bootstrap identity) and EXTERNAL_USER identities.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    status: varchar('status', { length: 32 })
      .$type<UserStatusColumn>()
      .notNull()
      .default('ACTIVE'),
    identityType: varchar('identity_type', { length: 32 })
      .$type<IdentityTypeColumn>()
      .notNull()
      .default('EXTERNAL_USER'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_users_email').on(table.email),
    index('idx_users_status').on(table.status),
    index('idx_users_identity_type').on(table.identityType),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Sessions table for secure server-side session management.
 * Tokens are hashed with SHA-256 before storage in database and cached in Redis.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_token_hash').on(table.tokenHash),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
