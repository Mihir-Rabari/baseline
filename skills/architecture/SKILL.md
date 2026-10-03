---
name: architecture
description: Monorepo package boundaries, layering rules, and extension patterns.
---

# Architecture Skill

## 1. When to Use
Use this skill when modifying monorepo structure, adding workspace packages, configuring inter-package dependencies, or reviewing dependency boundaries.

## 2. Package Boundaries & Layering
- **`apps/web` (Next.js)**: Frontend UI only. Must NEVER import `@packages/db` or connect directly to PostgreSQL/Redis/MinIO. Interacts with backend via `@/lib/api-client`.
- **`apps/api` (Fastify)**: HTTP gateway, routing, Zod input validation, error formatting, authorization route guards.
- **`packages/auth`**: Password hashing (`scrypt`), session lifecycle, HTTP-only cookie configuration.
- **`packages/iam`**: Permission catalog, policy evaluation engine, declarative route guards (`requirePermission`).
- **`packages/config`**: Environment parsing (`getEnv()`), application and feature settings (`AppConfig`, `IamConfig`, `AuthConfig`, `FeatureConfig`).
- **`packages/validation`**: Reusable Zod schemas and standard HTTP error response structures.
- **`packages/shared`**: Redis (`ioredis`), S3/MinIO client abstractions, and universal structured logger.
- **`packages/db`**: PostgreSQL connection pooling, Drizzle ORM schemas, migrations, seeds.

## 3. Inviolable Rules
1. Never bypass package boundaries: Packages under `packages/*` must never import from `apps/*`.
2. No circular dependencies between workspace packages.
3. Centralize environment variable access: Always use `getEnv()` from `@packages/config`.
4. Decouple storage: Use `StorageService` rather than raw MinIO endpoints.
5. All external data entering via API must be runtime-validated with Zod before database persistence.

## 4. Verification Checklist
- Run `pnpm typecheck` to verify workspace boundary isolation across all packages.
- Run `pnpm build` to ensure all packages compile cleanly.
