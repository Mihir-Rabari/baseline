# AGENTS.md — Repository Operating Manual

> **Scope**: Operating instructions, architectural rules, testing doctrine, skill discovery, skill packaging, dependency upgrade policy, and package conventions for automated coding agents and software engineers contributing to this repository or using the `create-odoo-app` generator.

---

## 1. Monorepo Architecture & Package Boundaries

This repository is a **pnpm workspaces monorepo** and generator for production-ready full-stack applications. Strict layering and boundary enforcement prevent architectural degradation:

```text
               ┌───────────────────────┐
               │    apps/web (Next)    │
               └───────────┬───────────┘
                           │ (HTTP / JSON / Cookies)
                           ▼
               ┌───────────────────────┐
               │   apps/api (Fastify)  │
               └───────────┬───────────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌───────────────┐
│ packages/auth│   │ packages/iam │   │packages/config│
└──────┬───────┘   └──────┬───────┘   └───────────────┘
       │                   │                   ▲
       ▼                   ▼                   │
┌──────────────┐   ┌──────────────┐            │
│ packages/db  │   │packages/shared           │
└──────┬───────┘   └──────┬───────┘            │
       │                   │                   │
       ▼                   ▼                   │
┌──────────────┐   ┌───────┴──────┐            │
│  PostgreSQL  │   │ Redis / S3   │            │
└──────────────┘   └──────────────┘            │
                           │                   │
                           ▼                   │
                   ┌───────────────────────────┴───┐
                   │     packages/validation       │
                   └───────────────────────────────┘
```

### Package Responsibilities & Subtree AGENTS.md

- **`apps/web`** ([`apps/web/AGENTS.md`](apps/web/AGENTS.md)): Next.js App Router, `@/lib/api-client`, TanStack Query hooks, AuthContext, permission-aware UI.
- **`apps/api`** ([`apps/api/AGENTS.md`](apps/api/AGENTS.md)): Fastify HTTP gateway, Zod type-provider, OpenAPI docs (`/api/docs`), Prometheus metrics (`/metrics`), structured logging, and authorization route guards.
- **`packages/auth`** ([`packages/auth/AGENTS.md`](packages/auth/AGENTS.md)): Node `scrypt` password hashing, timing-safe equality, server-side session management (`SessionManager`) with SHA-256 token hashing, and session cookie helpers.
- **`packages/iam`** ([`packages/iam/AGENTS.md`](packages/iam/AGENTS.md)): Permission catalog, centralized policy evaluation engine (`PolicyEngine`), `IamService`, and Fastify route guards.
- **`packages/db`** ([`packages/db/AGENTS.md`](packages/db/AGENTS.md)): Drizzle ORM schema modularity, PostgreSQL connection pooling, migrations, and deterministic seed runner.
- **`packages/config`**: Application metadata, authentication settings, declarative domain IAM configurations, and Zod environment parsing (`getEnv()`).
- **`packages/validation`**: Reusable runtime validation schemas and standardized HTTP error response schemas (`HttpErrorResponseSchema`).
- **`packages/shared`**: Redis (`ioredis`), S3/MinIO (`@aws-sdk/client-s3`) client abstractions, and universal structured logger.
- **`packages/openapi`**: OpenAPI 3.0 specification builder, `CookieAuth` security scheme, and schema utilities.

---

## 2. Inviolable Security & Architectural Rules

1. **Rule 1**: Frontend must never access PostgreSQL, Redis, or MinIO credentials directly.
2. **Rule 2**: Backend owns security-sensitive operations, data persistence, and authorization.
3. **Rule 3**: Packages in `packages/*` must not depend on `apps/*`.
4. **Rule 4**: Infrastructure configuration (ports, hosts, credentials) must be read from `packages/config` / `.env`, never hardcoded.
5. **Rule 5**: No circular dependencies between workspace packages.
6. **Rule 6**: Prefer small composable abstractions over giant catch-all utilities.
7. **Rule 7**: Do not duplicate environment parsing logic; always import `getEnv()` from `@packages/config`.
8. **Rule 8**: Validate all external inputs at API boundaries using Zod schemas.
9. **Rule 9**: Do not couple application logic to MinIO-specific endpoints; use the `StorageService` abstraction.
10. **Rule 10 (Authorization)**:
    - `ROOT` identity has unconditional administrative authority.
    - Explicit `DENY` statements strictly override `ALLOW` statements.
    - Self-resource permissions (`:self`) strictly enforce that `context.resourceOwnerId === identity.id`.
    - Suspended and disabled accounts are denied all authenticated operations.
11. **Rule 11 (Dependency Upgrade Policy)**:
    - Do not blindly upgrade dependencies.
    - Check current stable version and read relevant migration notes.
    - Verify peer compatibility across Node 20/22, Next.js, Fastify, Drizzle, and Zod.
    - Update `pnpm-lock.yaml` deterministically; CI enforces frozen lockfiles (`--frozen-lockfile`).
    - Run targeted tests, generator smoke test, and full quality gate before completing any upgrade.

---

## 3. Agent-Enforced Testing Doctrine & Quality Rules

All automated coding agents and software engineers must strictly adhere to these testing laws:

1. **Rule T1 (Verification Requirement)**: Every new behavior must have automated tests proving its correctness.
2. **Rule T2 (Regression Defense)**: Every bug fix must include a permanent regression test capturing the discovered failure condition.
3. **Rule T3 (Security Adversarial Testing)**: Security-sensitive changes require explicit adversarial negative tests (privilege escalation, unauthorized access, expired sessions, mismatched resource ownership).
4. **Rule T4 (API Contracts)**: Every API route must be tested with Fastify `app.inject()` verifying validation (400), authentication (401), authorization (403), and success shapes.
5. **Rule T5 (Database Integrity)**: Database schema modifications require migration verification and seed idempotency tests.
6. **Rule T6 (Generator Smoke Coverage)**: Generator changes must pass full distributable smoke testing (`pnpm test:smoke`, `pnpm test:dogfood`, `pnpm verify:release`).
7. **Rule T7 (Quality Gates)**: Do not reduce coverage thresholds or delete tests to make a build pass.
8. **Rule T8 (Pre-Completion Verification)**: Always run the full verification gate (`pnpm verify`) before declaring any task complete.

---

## 4. Standard Development & Quality Verification Commands

All commands should be executed from the repository root:

```bash
# Development
pnpm dev              # Launch web and api concurrently
pnpm dev:api          # Launch Fastify API in watch mode
pnpm dev:web          # Launch Next.js web application

# Dependency Management & Maintenance
pnpm deps:check       # Inspect and audit direct dependency baselines

# Agent Skills Management & Packaging
pnpm skills:list      # List all 14 canonical skills with descriptions
pnpm skills:show <n>  # Display metadata and content for a skill
pnpm skills:check     # Validate Agent Skills registry, frontmatter, and links
pnpm skills:lint      # Structural markdown and frontmatter linter
pnpm skills:pack      # Package skills into deterministic ZIP archives in dist/skills/
pnpm skills:export    # Export standalone clean skill directories in dist/skills/

# Quality Verification & Testing
pnpm test             # Run Vitest test suite across all packages
pnpm test:coverage    # Run Vitest test suite with v8 coverage analysis
pnpm test:smoke       # Run generator smoke test in temporary directory
pnpm test:dogfood     # Execute end-to-end generator dogfooding test
pnpm test:security    # Run dedicated security & adversarial test suites
pnpm typecheck        # Run TypeScript type check across all packages + CLI
pnpm lint             # Run linting across all packages
pnpm build            # Build all packages, apps, and CLI executable
pnpm verify           # Complete local quality gate (skills + lint + typecheck + test + smoke + build)
pnpm verify:release   # Pre-release gate (build + pack + unpacked tarball generator test)
pnpm release:check    # Canonical pre-release verification checklist

# Database & Migrations
pnpm setup            # Cross-platform idempotent setup and database seeding
pnpm db:migrate       # Apply pending Drizzle PostgreSQL migrations
pnpm db:seed          # Execute deterministic seed runner (bootstraps ROOT & baseline IAM)
pnpm db:studio        # Open Drizzle database GUI

# Infrastructure (Docker Compose)
pnpm infra:up         # Start PostgreSQL, Redis, MinIO, Prometheus, Grafana
pnpm infra:down       # Stop all infrastructure containers
pnpm infra:reset      # Destroy containers and remove persistent volumes
pnpm health           # Run end-to-end infrastructure health check
```

---

## 5. Structured Logging & Observability Rules

1. **Use the Shared Logger**: Always import `logger` or `createLogger` from `@packages/shared`.
2. **No `console.log`**: Never use `console.log`, `console.error`, or `console.warn` in backend application code.
3. **Request Correlation**: Every HTTP request must have an `x-request-id` header generated or sanitized by Fastify.
4. **Error Correlation**: Every unexpected error must produce a structured server log and return a sanitized `HttpErrorResponse` containing `requestId`. Never expose stack traces to clients.
5. **Defensive Redaction**: Never log passwords, tokens, session cookies, database connection strings, or secrets.
6. **OpenAPI Synchronization**: Keep OpenAPI route schemas and `CookieAuth` security schemes synchronized with actual route behavior.

---

## 6. Agent Skills Standard, Discovery & Composition

This repository provides 15 standardized Agent Skills under `skills/` following the **Agent Skills open standard**. Use `skills/index.yaml` as the machine-readable discovery registry.

### Repository Guidance vs Skill Bundles
- **`AGENTS.md`**: Persistent repository operating manual describing architecture, commands, and rules.
- **`skills/*/`**: Portable, self-contained workflow instruction bundles that can be individually loaded by agents or packaged into ZIP archives for Agent Skills platforms.

### Targeted Context Loading Workflow
Before modifying a subsystem:
1. **Identify**: Review the Skills Index below to find the governing skill(s).
2. **Read**: Open and read the relevant `SKILL.md` file(s).
3. **Follow Constraints**: Apply the rules, conventions, and invariants documented in the skill.
4. **Implement & Test**: Add automated tests proving correctness.
5. **Verify**: Run `pnpm verify` to satisfy all repository quality gates.

### Canonical Skill Composition Matrix

| Task Type | Primary Skills | Supporting Skills |
| :--- | :--- | :--- |
| **API Endpoint Development** | [`skills/api/SKILL.md`](skills/api/SKILL.md) | `validation`, `testing`, `security` |
| **Authentication & Sessions** | [`skills/authentication/SKILL.md`](skills/authentication/SKILL.md) | `security`, `testing` |
| **IAM, Roles & Permissions** | [`skills/authorization/SKILL.md`](skills/authorization/SKILL.md) | `security`, `database`, `testing` |
| **Database Schema & Migrations** | [`skills/database/SKILL.md`](skills/database/SKILL.md) | `testing` |
| **Frontend UI & Forms** | [`skills/design/SKILL.md`](skills/design/SKILL.md), [`skills/frontend/SKILL.md`](skills/frontend/SKILL.md) | `authorization`, `testing` |
| **Landing & Marketing Pages** | [`skills/design/SKILL.md`](skills/design/SKILL.md) | `frontend` |
| **Observability & Logging** | [`skills/observability/SKILL.md`](skills/observability/SKILL.md) | `api`, `testing` |
| **Object Storage & Uploads** | [`skills/storage/SKILL.md`](skills/storage/SKILL.md) | `validation`, `security`, `testing` |
| **Dependency Modernization** | [`skills/dependencies/SKILL.md`](skills/dependencies/SKILL.md) | `testing`, `security` |

### Canonical Skills Index

| Skill | Path | Description |
| :--- | :--- | :--- |
| **Architecture** | [`skills/architecture/SKILL.md`](skills/architecture/SKILL.md) | Monorepo package boundaries, layering rules, and extension patterns. |
| **Authentication** | [`skills/authentication/SKILL.md`](skills/authentication/SKILL.md) | Password hashing (scrypt), server-side session tokens, HTTP-only cookies, and auth events. |
| **Authorization** | [`skills/authorization/SKILL.md`](skills/authorization/SKILL.md) | Identity and Access Management, policy evaluation engine, declarative route guards, and permissions. |
| **Database** | [`skills/database/SKILL.md`](skills/database/SKILL.md) | PostgreSQL schema conventions, Drizzle ORM, migrations, deterministic seeding, and database integrity. |
| **API** | [`skills/api/SKILL.md`](skills/api/SKILL.md) | Fastify route development, Zod type providers, OpenAPI documentation, structured logging, and error responses. |
| **Frontend** | [`skills/frontend/SKILL.md`](skills/frontend/SKILL.md) | Next.js App Router, Tailwind CSS, TanStack Query, AuthContext, and permission-aware UI. |
| **Design** | [`skills/design/SKILL.md`](skills/design/SKILL.md) | Visual design law — screen structure, colour tokens, typography, icons, spacing, and the states every screen owes the user. |
| **Security** | [`skills/security/SKILL.md`](skills/security/SKILL.md) | Zero-trust input rules, server-side authorization, credential protection, and adversarial security testing. |
| **Validation** | [`skills/validation/SKILL.md`](skills/validation/SKILL.md) | Runtime Zod validation schemas, business bounds, date ordering, and pagination limits. |
| **Testing** | [`skills/testing/SKILL.md`](skills/testing/SKILL.md) | Testing doctrine, pyramid (unit, integration, API, security, smoke), AAA pattern, and coverage enforcement. |
| **Storage** | [`skills/storage/SKILL.md`](skills/storage/SKILL.md) | S3/MinIO StorageService abstraction, bucket management, and object storage conventions. |
| **Email** | [`skills/email/SKILL.md`](skills/email/SKILL.md) | Transactional email provider integration, templates, and delivery rules. |
| **Realtime** | [`skills/realtime/SKILL.md`](skills/realtime/SKILL.md) | Redis Pub/Sub messaging and realtime notification events. |
| **Observability** | [`skills/observability/SKILL.md`](skills/observability/SKILL.md) | Structured logging, request correlation, Prometheus metrics, health probes, and sensitive data redaction. |
| **Dependencies** | [`skills/dependencies/SKILL.md`](skills/dependencies/SKILL.md) | Monorepo dependency inventory, safe version upgrades, lockfile integrity, and compatibility verification. |
