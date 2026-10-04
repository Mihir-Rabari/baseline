---
name: database
description: PostgreSQL schema conventions, Drizzle ORM, migrations, deterministic seeding, and database integrity.
---

# Database Skill

## 1. When to Use
Use this skill when defining database tables, Drizzle ORM relations, generating migrations, writing seed routines, or executing database queries.

## 2. Schema Conventions
- Define tables in modular files under `packages/db/src/schema/<module>.ts`.
- Re-export all tables in `packages/db/src/schema/index.ts`.
- Use UUID primary keys: `id: uuid('id').defaultRandom().primaryKey()`.
- Always include timestamps:
  ```typescript
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  ```
- Always define foreign keys with appropriate `onDelete` cascade or restrict behaviors.
- Index lookup columns (e.g. `email`, `status`, `userId`, `tokenHash`).

## 3. Migrations & Seed Idempotency
- Generate migrations: `pnpm db:generate`.
- Apply migrations: `pnpm db:migrate`.
- Seed data idempotently: `pnpm db:seed`.
- The seed runner must check for existing records (e.g. `ROOT` account, default policies) and never overwrite or reset user data on repeated runs.

## 4. Mandatory Testing Expectations
Every database schema change requires:
1. **Migration Verification**: Validating that Drizzle migration files generate cleanly and apply without syntax errors.
2. **Constraint Testing**: Verifying that unique indexes (e.g. unique emails) and foreign keys enforce data integrity.
3. **Seed Idempotency**: Testing that executing the seed runner repeatedly produces zero duplicate rows and preserves existing credentials.

## 5. Multi-Tenancy (club isolation)
- Every club-owned table has `tenant_id` (`tenantId()` from `schema/_tenant.ts`), a per-club unique index for any name/code a club chooses, and a `tenant_isolation` row-level-security policy (see migration `0017_tenant_isolation.sql`). Only the shared `permissions` catalogue and the control-plane `tenants*` tables are exempt. The isolation suite (`apps/api/src/tenant-isolation.test.ts`) fails if a new table lacks the policy.
- Statements run inside `runInTenant(id, fn)` execute as the `baseline_tenant` role with a transaction-local `app.tenant_id`, each on one pinned connection (`tenant-scope.ts`), so no pooled connection keeps a club between statements. The API enters the scope for every request. Outside a scope (seeds, migrations) or inside `runUnscoped` the owner role is used, which bypasses RLS: only platform code may do that.
- Lazy drizzle builders run when awaited, so wrap with `runInTenant(id, async () => await ...)`.
- Seeds target the default club. A new club is seeded atomically with `seedTenantIam` plus `DEFAULT_CATEGORIES` (`scopeTransaction`).
