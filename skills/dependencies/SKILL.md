---
name: dependencies
description: Monorepo dependency inventory, safe version upgrades, lockfile integrity, and compatibility verification.
---

# Dependencies Skill

## 1. When to Use
Use this skill when auditing monorepo dependencies, planning package upgrades, resolving peer dependency conflicts, executing security audits, or maintaining lockfile integrity.

## 2. Inviolable Dependency Upgrade Rules
1. **Never Blindly Upgrade**: Do not upgrade packages to latest available releases without verifying breaking changes, changelogs, and peer compatibility.
2. **Synchronized Core Stack**:
   - `next`, `react`, and `react-dom` must remain compatible with Next.js App Router.
   - `fastify`, `@fastify/*` plugins, and `fastify-type-provider-zod` must be verified together with Zod schemas.
   - `drizzle-orm`, `drizzle-kit`, and `postgres` must be tested against existing migrations and database types.
3. **Lockfile Integrity**:
   - Always run `pnpm install` locally to update `pnpm-lock.yaml` deterministically.
   - CI must enforce frozen lockfiles (`pnpm install --frozen-lockfile`) and never modify the lockfile in automated pipelines.
4. **Package Manager Parity**:
   - Keep `packageManager` in `package.json`, setup scripts, CI workflows, and documentation strictly synchronized.

## 3. Dependency Audit Workflow
1. **Inspect Direct Inventory**:
   ```bash
   pnpm deps:check
   ```
2. **Review Outdated Packages**:
   ```bash
   pnpm outdated
   ```
3. **Security Vulnerability Audit**:
   ```bash
   pnpm audit
   ```
4. **Upgrade & Verify Lifecycle**:
   - Update declared package versions in relevant `package.json` files.
   - Run `pnpm install` to update `pnpm-lock.yaml`.
   - Run full verification: `pnpm verify` and `pnpm verify:release`.

## 4. Mandatory Testing Expectations
Every dependency modification requires:
1. **TypeScript Typecheck**: Running `pnpm typecheck` to verify zero type regressions.
2. **Unit & Contract Tests**: Running `pnpm test` and `pnpm test:security`.
3. **Generator Smoke Test**: Running `pnpm test:smoke` to ensure scaffolding remains functional.
4. **Release Gate**: Running `pnpm release:check` to ensure tarball packing and fresh project scaffolding succeed.
