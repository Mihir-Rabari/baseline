# Database Management (`packages/db`) — Subtree Operating Manual

> **Scope**: PostgreSQL database connection pooling, Drizzle ORM schema modularity, migrations journal, and deterministic idempotent seed runners.

---

## 1. Subtree Architecture & Conventions

1. **Schema Modularity**:
   - Define schema modules in `src/schema/<module>.ts` (`system.ts`, `auth.ts`, `iam.ts`).
   - Re-export all tables, relations, and enums in `src/schema/index.ts`.
   - Use UUID primary keys and standard `createdAt` / `updatedAt` timestamps.

2. **Migrations & Seed Idempotency**:
   - Generate migrations: `pnpm db:generate`.
   - Apply migrations: `pnpm db:migrate`.
   - Run seeds: `pnpm db:seed`.
   - The seed runner must be idempotent and never duplicate baseline IAM records or overwrite existing credentials.

3. **Testing Expectations**:
   - Database client connection tests, migration integrity verification, and seed idempotency tests.
