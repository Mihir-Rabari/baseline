# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.0] - 2026-09-05

### Added
- **A real landing page at `/`, generated for every project.** Previously `/` was the live status dashboard, so a scaffolded app had no front door. It follows one claim → one proof → one next step, and uses the live service probe as the proof.
- **An application shell.** `Sidebar`, `Topbar`, `PageHeader`, and `EmptyState` under `components/app-shell/`. `PageHeader` gives every screen one consistent heading treatment; `EmptyState` exists so a list with no records stops rendering a grid of cards that all read "None listed".
- **`skills/design/SKILL.md`** — the design law for generated apps: route groups, colour tokens, typographic roles, when an icon is permitted (and that emoji never are), the four states every screen owes the user, density, copy, and accessibility. `skills/frontend/SKILL.md` was 35 lines of pure plumbing with no design guidance at all, which is why agents building on this template defaulted to gradients and emoji.

### Changed
- **The `--theme` flag now actually themes the app.** It previously wrote only `components.json`'s `baseColor` — a field nothing reads at runtime, since it only affects later `npx shadcn add` runs — while `globals.css` shipped byte-identical. Choosing "Violet / Indigo" produced exactly the same grey app as "Neutral / Slate". Each of the four themes now carries a full light *and* dark palette, a font pairing, and a corner radius, all written into `globals.css` and `layout.tsx` at generation time.
- **Routes are split into three groups**, each owning its own chrome: `(marketing)` (public header/footer), `(app)` (sidebar, topbar, and the auth guard), and `(auth)` (a bare centred frame). URLs are unchanged. Because the guard lives in the `(app)` layout, a new screen cannot forget it, and pages render content only — no auth branching, no width override, no navigation of their own.
- **The admin section's nested sidebar became a tab strip.** Two vertical navigation rails side by side was the wrong answer once the app shell existed.
- **`skills/frontend/SKILL.md` and both `AGENTS.md` files** now lead with the non-negotiables and defer to the design skill.

### Fixed
- **The project rename could silently stop working.** It targeted `apps/web/src/components/navbar.tsx` and nothing asserted on the result, so removing that file would have left every generated app displaying "Production Starter" while all 46 smoke assertions still passed. The wordmark now spans three layouts, each verified — along with the theme reaching `globals.css` and the font markers surviving. The smoke test went from 46 assertions to 57.

---

## [1.2.0] - 2026-09-04

### Changed
- **Redesigned the generated frontend.** The scaffolded app read like a brochure rather than an application: 40-word marketing sentences, "ROOT AUTHORITY" and "Infrastructure Status Probe" headings, a Sparkles icon on an admin button, a crown emoji in the navbar, and a decorative pulsing dot. The copy is now plain, and the decoration is gone.
- **Status colour is now the only hue in the palette.** New `--success` / `--warning` tokens replace hardcoded `indigo`/`emerald`/`amber`/`rose`/`blue` classes across nine files. Half of them had no `dark:` variant, so dark mode was visibly inconsistent. A coloured pixel now always means a system state.
- **Typography.** Inter and JetBrains Mono are loaded via `next/font` instead of falling through to the browser's default stack.
- **The dashboard shows real data.** Its three stat tiles rendered static strings — "Security: HTTP-Only Cookie", "Precedence: Explicit Deny Override" — styled as if they were live metrics. They are now a definition list of actual account and session fields.

### Fixed
- **Dark-mode `--destructive` failed contrast as text** at 30.6% lightness. Raised to a readable red.
- **Six pages nested a `container` inside `<main>`'s container,** rendering at double horizontal padding with a competing max-width. `<main>` is now the only container in the tree.
- **Object storage reported "Operational" when its status was unknown.** `system-status` defaulted the storage service to `'ok'`; it now reports Unknown rather than claiming health it has not observed.
- **The login page rendered the default root credentials in production builds.** The `root@example.com` / password hint block is now gated behind `NODE_ENV !== 'production'` and no longer prints the password.

### Removed
- **Internal roadmap text shipped as UI in every scaffolded app:** the `Phase 2: Identity & IAM` navbar badge and the `Phase 1 Foundation • Zero Hackathon Assumptions` footer.
- **Hardcoded `http://localhost:3001`** in the navbar's API docs link and in the status error message. Both now use `API_BASE_URL`, so a deployed app points at its real API instead of the developer's laptop.
- **`.claude` is now in `TEMPLATE_IGNORES`.** Local agent configuration was being copied into every generated project.

---

## [1.1.3] - 2026-09-04

### Fixed
- **`pnpm test` crashed instantly in every scaffolded app.** `apps/web/vitest.setup.ts` and `packages/iam/vitest.config.ts` were never added to `package.json`'s `files` array, so they never shipped to npm — while the root `vitest.config.ts` (which does ship) references the former by absolute path. Every generated project's test suite failed outright with `Cannot find module`. Both files are now included.
- **CLI-only runtime dependencies leaked into every generated app's `package.json`.** `@clack/prompts`/`picocolors` (added for the interactive wizard in 1.1.1) are meaningless in a scaffolded Next.js/Fastify starter; `transformProjectMetadata` now strips them like it already does for `bin`, `files`, and the CLI's own publish scripts.
- **`scripts/security-audit.test.ts` was copied into every generated app and failed there.** It shells out to `git ls-files` and asserts against *this* repo's own tracked-file set and identity — neither means anything once renamed and rescaffolded. This and its sibling CLI-development-only scripts (`verify-release.ts`, `smoke-test.ts`, `dogfood-test.ts`) are no longer copied into scaffolded projects.
- **`scripts/verify-release.ts` never actually ran the generated application.** It checked file *existence* only; none of the three bugs above would have reached npm as `1.1.2` if it had. It now runs `pnpm install && pnpm test` against the real scaffolded output before every release.

---

## [1.1.2] - 2026-09-04

### Changed
- Release build, dependencies validation, and npm deployment with full support for OIDC Trusted Publishing and interactive CLI prompts.

---

## [1.1.1] - 2026-09-03

### Fixed
- **Interactive CLI prompts actually ship.** 1.1.0's release commit landed only the shadcn/ui redesign half of the feature; `src/prompts.ts` and the `cli.ts`/`generator.ts` wiring for it, along with `next-themes`/`sonner` integration (`theme-provider.tsx`, `theme-toggle.tsx`, `sonner.tsx`, `tooltip.tsx`, and the root layout wiring), were dropped before commit and are restored here.
- `@clack/prompts` and `picocolors` moved from `devDependencies` to `dependencies` — as dev-only deps they were never installed for anyone running the published package, so the interactive wizard would have thrown `ERR_MODULE_NOT_FOUND` on first use.
- `--theme <name>` is now actually parsed outside the interactive prompt path; it was documented in `--help` but silently ignored when combined with `-y`/`--yes`.
- `scripts/verify-release.ts` now installs the packed artifact's production dependencies before executing it, matching what `npx create-odoo-app` does for a real user — it previously ran `dist/cli.js` straight out of the tarball with no `node_modules`, which is why the two bugs above weren't caught before publishing.

---

## [1.1.0] - 2026-09-03

### Added
- **Interactive CLI Setup (`@clack/prompts`)**:
  - Beautiful, accessible terminal prompts when running `npx create-odoo-app <dir>` without `-y` / `--yes`.
  - Configurable project name, color palette theme (`neutral`, `zinc`, `violet`, `rose`), architecture modules (IAM Governance, Prometheus Observability, S3/MinIO Object Storage), Git initialization, and automated dependency installation.
  - Automatic non-interactive fallback for CI / scripting workflows with `-y` or non-TTY environments.
- **Modern shadcn/ui Component Suite in `apps/web`**:
  - Integrated Radix UI primitives: `@radix-ui/react-avatar`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-label`, `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `@radix-ui/react-switch`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`.
  - Built comprehensive, modular UI components in `apps/web/src/components/ui/` (`Button`, `Card`, `Input`, `Label`, `Badge`, `Dialog`, `DropdownMenu`, `Tabs`, `Table`, `Avatar`, `Switch`, `Select`, `Separator`, `Skeleton`, `Alert`, `Tooltip`, `Toaster`, `ThemeToggle`).
  - Integrated `next-themes` for seamless Dark / Light / System mode switching.
  - Integrated `sonner` for rich, animated toast notifications across all user actions.
- **Modernized User Interface & Design System**:
  - Redesigned Landing page (`apps/web/src/app/page.tsx`) with dynamic architecture visualizers, live system status probes, and hero actions.
  - Redesigned Authentication pages (`/login`, `/signup`) with cryptographic session badges and developer credentials prefilling.
  - Redesigned User Dashboard (`/dashboard`) and Profile (`/profile`) with avatar initials, live effective IAM permission badges, and secure password updates.
  - Redesigned IAM Admin Console (`/admin`, `/admin/iam/*`) with modern Data Tables, interactive status toggles, granular policy statement inspectors, and group/role managers.
- **Modernized Agent Skills**:
  - Updated `skills/frontend/SKILL.md` with shadcn/ui component documentation, Radix primitives, and UI testing patterns.
  - Verified and packaged all 14 Agent Skills into deterministic ZIP archives in `dist/skills/`.


### Security
- **Upgraded `drizzle-orm` to `^0.45.2`**, which patches a SQL injection advisory affecting every version below it. The previous `^0.39.3` range could never reach the fix.
- **Patched three transitive advisories** via `overrides` in `pnpm-workspace.yaml`: `postcss` (path traversal / arbitrary file read, reached through `next`) and `@fastify/static` (route guard and authorization bypass, reached through `@fastify/swagger-ui`). `pnpm audit --prod` now reports zero vulnerabilities, and CI fails on any new one.
- **Stopped `passwordHash` leaking through the API.** `updateUserStatus` returned an unprojected `users` row and its route declared `200: z.any()`, so Fastify's response serializer stripped nothing. All 14 `z.any()` IAM response schemas are replaced with real ones, and user reads go through a single `SAFE_USER_COLUMNS` projection.
- **Per-project secrets.** Every generated app previously shipped the same `SESSION_SECRET` and `INITIAL_ROOT_PASSWORD`, both public in `.env.example`. The CLI now mints unique values per project and prints the root password once. The API refuses to start with `NODE_ENV=production` while any published default remains, listing every offender at once.
- **Policy `resources` and `conditions` are now evaluated.** Both fields existed on `PolicyStatement` and were accepted by the API, but the engine ignored them: a policy scoped to one resource granted the action on all of them. Resource matching supports exact, prefix-wildcard and `*`; conditions support `StringEquals`, `StringNotEquals`, `Bool` and `OwnerEquals`, and fail closed on an unrecognised operator.
- **`:self` ownership now fails closed.** The check previously ran only when `resourceOwnerId` was supplied, so a route that omitted it skipped the gate entirely.
- **Blocked privilege escalation through policy attachment.** Holding `policies:update` was enough to attach an `allow *` policy to your own account. Grants are now rejected unless the actor already holds every permission being conferred.
- **Protected system records.** The `isSystem` flag was set by the seed and enforced nowhere; deleting the default external-user policy silently broke all future signups. System roles, groups and policies are now immutable through the API.
- **Protected the ROOT identity.** Any holder of `users:update` could suspend the ROOT account and lock the platform out. ROOT suspension and self-suspension are now refused.
- **Fixed rate limiting behind a proxy.** The limiter allowlisted `127.0.0.1`, which behind nginx, a load balancer or Docker ingress matched every request and disabled rate limiting entirely — including on `/auth/login`. The allowlist is gone and a `TRUST_PROXY` setting configures `request.ip` correctly.
- **Added per-email login lockout** (`LoginThrottle`), enforcing the previously decorative `AuthConfig.maxLoginAttempts`. Degrades to no-lockout if Redis is unavailable rather than causing an authentication outage.
- **Closed the login timing oracle.** An unknown email returned before any hashing, making account existence measurable. A dummy scrypt verification now runs on that path.
- **Hardened Docker Compose.** Services bind to `127.0.0.1` by default instead of `0.0.0.0`; Redis now actually receives `REDIS_PASSWORD`; Grafana anonymous access is off by default and its credentials are configurable; MinIO images are pinned instead of `:latest`.
- **Scoped the Swagger CSP.** `script-src 'unsafe-inline'` was applied to the entire API to make one HTML page render; it now applies only to `/api/docs`.
- **Fixed the cross-site session cookie.** `sameSite` was a no-op ternary returning `'lax'` in both branches, silently dropping the session cookie when web and API are on different hosts.

### Fixed
- Removed 24 committed build artifacts from `packages/config/src`. Vite and Node both resolve a sibling `./x.js` ahead of `./x.ts`, so the stale compiled output was shadowing the TypeScript source at test time. `.gitignore` now prevents recurrence.
- `create-odoo-app .` no longer overwrites a non-empty current directory, and no longer prints a `cd` step for a directory you are already in.
- Removed the `--skip-infra` flag, which was parsed and advertised but never used.
- Generated projects no longer inherit `ignore-scripts` (which permanently suppressed install scripts for the user's own dependencies) or the generator's `repository`, `bugs`, `homepage` and `author` fields.
- Signup is now transactional; a failed policy attachment previously left an account with no permissions and an unusable email address.
- The error handler no longer reports unmapped 4xx statuses as `INTERNAL_SERVER_ERROR`, and now surfaces domain error codes such as `PRIVILEGE_ESCALATION_BLOCKED`.
- `verify:release` no longer fails on Windows checkouts outside `C:` — GNU tar was reading the absolute archive path as a remote `host:path` spec.
- The seed script shares `hashPassword` with the login path instead of reimplementing scrypt, which would have drifted the moment the parameters were tuned.
- `@packages/config` no longer re-exports the Node-only env loader from its main entry point, which would break the Next.js client build for anyone following the README's advice to configure the app there. Server code imports `@packages/config/env`.

### Changed
- **Replaced the placeholder `lint` scripts.** Every package ran `echo "lint ok"`; there was no ESLint config in the repo, so `pnpm verify` and the CI lint step always passed. Real ESLint now runs with `--max-warnings 0`, and the 29 unused imports and `any` annotations it found are fixed.
- **Tightened vacuous test assertions.** Five tests accepted a range of status codes wide enough to pass whether the endpoint worked or crashed — including the privilege-escalation test, which allowed `[201, 400, 500, 503]`. Database-dependent tests now skip explicitly rather than passing without running.
- **Added coverage thresholds.** `test:coverage` previously reported numbers nothing acted on. A global floor plus stricter floors on the policy engine (now 100% statements) and password crypto.
- Test suite grew from 110 to 165 tests.
- CI now runs a dependency vulnerability audit, and a dedicated Linux job exercises migrations and the seed script against real PostgreSQL and Redis containers.
- `AuthConfig.registrationEnabled` and `minPasswordLength` are enforced instead of being documented knobs that did nothing.
- Signup rejects unknown request fields outright (`.strict()`) rather than silently discarding them.

## [1.0.10] - 2026-09-02

### Fixed
- Automated silent and safe pnpm dependency installs: configured `ignore-scripts=true` in `.npmrc` and invoked `pnpm install --ignore-scripts` during project generation to ensure immediate, error-free setup on pnpm v10 and v11.

## [1.0.9] - 2026-09-02

### Fixed
- Fixed pnpm v10/v11 `ERR_PNPM_IGNORED_BUILDS` on scaffolded apps: cleanly configured `onlyBuiltDependencies` in `pnpm-workspace.yaml` allowing esbuild and Next.js native binaries to run builds without prompting `pnpm approve-builds`.
- Cleaned up `.npmrc` configuration across workspace.

## [1.0.8] - 2026-09-02

### Fixed
- Fixed unstyled frontend: packaged `apps/web/postcss.config.mjs`, `apps/web/next.config.mjs`, and `apps/web/components.json` in published npm bundle so Tailwind CSS generates all styles in scaffolded Next.js apps.
- Updated `pnpm-workspace.yaml` with `onlyBuiltDependencies: [esbuild]` to eliminate pnpm configuration deprecation warnings.

## [1.0.7] - 2026-09-02

### Fixed
- Direct TypeScript source exports for workspace packages: updated `packages/*/package.json` exports to point directly to `src/index.ts`, enabling instant hot-reloading, `pnpm db:migrate`, and `pnpm db:seed` without requiring pre-compilation of `dist`.
- Updated MinIO and MinIO Client image tags in `docker-compose.yml` to standard reliable tags.

## [1.0.6] - 2026-09-02

### Fixed
- Fixed `npm error code EUNSUPPORTEDPROTOCOL` on `npx create-odoo-app`: removed `workspace:*` dependencies from root `package.json` so `npm` and `npx` install and execute the generator cleanly on all platforms.
- Configured path aliases in root `tsconfig.json` so root scripts (`scripts/health-check.ts`, `scripts/setup.ts`) resolve internal packages directly.

## [1.0.5] - 2026-09-02

### Fixed
- Workspace package resolution in root scripts: configured root `dependencies` and `tsconfig.base.json` path mappings so root scripts (`pnpm health`, `pnpm setup`, `scripts/health-check.ts`) resolve `@packages/*` directly in both generator and generated monorepo apps.

## [1.0.4] - 2026-09-01

### Added
- Preconfigured `.gitignore` file automatically created in all scaffolded applications, ignoring `node_modules`, `.pnpm-store`, environment secrets (`.env`, `.env.*`), build outputs (`dist`, `.next`), coverage, temporary files, and Docker volume data directories.
- Filtered out `.npmignore` from generated projects.

## [1.0.3] - 2026-09-01

### Added
- Preconfigured `.gitignore` file guaranteed to be created in all scaffolded applications, ignoring `node_modules`, `.pnpm-store`, environment secrets (`.env`, `.env.*`), build outputs (`dist`, `.next`), coverage, temporary files, and Docker volume data directories.
- Filtered out `.npmignore` from generated projects.

## [1.0.2] - 2026-09-01

### Fixed
- Transformed root build/typecheck scripts in generated applications so `tsc -p tsconfig.cli.json` is not executed in generated projects.

## [1.0.1] - 2026-09-01

### Fixed
- Tailored scripts in generated user applications: removed generator-specific CLI build/release scripts (`build:cli`, `verify:release`, `release:check`, `release:pack`, `test:smoke`, `test:dogfood`) from generated `package.json`.
- Streamlined `pnpm typecheck`, `pnpm build`, and `pnpm verify` commands in generated projects.

## [1.0.0] - 2026-08-30

### Added
- **Project Generator (`create-odoo-app`)**:
  - Executable CLI (`npx create-odoo-app@latest <project-name>`) supporting project scaffolding, argument parsing, help (`-h`), version (`-v`), and skip flags (`--skip-install`, `--skip-git`, `--skip-infra`).
  - Deterministic project metadata and branding transformations (`package.json`, `app-config.ts`, Next.js `<title>`, navbar branding, OpenAPI title, tailored `README.md`, `AGENTS.md`).
  - Template isolation filter preventing leakage of `.git`, `node_modules`, `dist`, `.next`, `brain/`, and local credentials.
- **Identity, Authentication & IAM System**:
  - Password hashing with Node native `scrypt` and timing-safe comparison (`crypto.timingSafeEqual`).
  - Server-side session management (`SessionManager`) with SHA-256 token hashing in PostgreSQL and Redis caching.
  - HTTP-only session cookies (`SameSite=Lax`, `Path=/`, `Secure` in production).
  - IAM Policy Evaluation Engine enforcing **Explicit Deny Precedence**, **ROOT superuser authority**, wildcard pattern matching (`users:*`), and resource ownership checks (`:self`).
  - Declarative Fastify route guards (`requireAuthentication`, `requirePermission`, `requireAnyPermission`).
  - Next.js Admin IAM Control Center (`/admin`, `/admin/iam/users`, `/admin/iam/roles`, `/admin/iam/groups`, `/admin/iam/policies`, `/admin/iam/permissions`) with live Effective Permissions Calculation view.
- **OpenAPI & Structured Logging Hardening (Phase 5.1)**:
  - Universal structured logger in `@packages/shared` with automatic defensive sensitive data redaction (`password`, `token`, `secret`, `apiKey`, `cookie`, `authorization`, `databaseUrl`, `SESSION_SECRET`).
  - Fastify request correlation ID propagation (`x-request-id` header sanitization and onSend response tracing).
  - Correlated error payloads (`HttpErrorResponse`) containing matching `requestId` for client diagnostics without stack trace leakage.
  - Accurate OpenAPI 3.0 `CookieAuth` security scheme (`app_session` cookie) and standard reusable error schemas.
  - Operational event logging across Auth (`auth.signup.success`, `auth.login.failure`, `auth.logout`, `auth.session.revoked`) and IAM (`iam.user.status_updated`, `iam.role.assigned`).
- **Real Agent Skills Standard & Skill Discovery Architecture (Phase 6)**:
  - Agent Skills open-standard compliant skill bundles with matching directory names and YAML frontmatter (`name`, `description`).
  - Machine-readable skill registry (`skills/index.yaml`) cataloging all 13 canonical skills.
  - Automated skill validation tooling (`scripts/check-skills.ts` / `pnpm skills:check`).
  - Localized subtree `AGENTS.md` context files (`apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `packages/auth/AGENTS.md`, `packages/iam/AGENTS.md`, `packages/db/AGENTS.md`).
  - Propagation of skills registry and localized context manuals into generated projects.
- **Agent Skills Runtime Compatibility, Packaging & Discovery Hardening (Phase 6.1)**:
  - Deterministic skill bundle packer (`scripts/pack-skills.ts` / `pnpm skills:pack`) outputting clean directory bundles and standard zero-dependency ZIP archives in `dist/skills/` compatible with OpenAI Skills API and portable Agent Skills platform consumption.
  - Skill CLI utilities: `pnpm skills:list`, `pnpm skills:show <name>`, `pnpm skills:lint`, and `pnpm skills:export`.
  - Deterministic context discovery & skill packaging automated test suite (`src/skills.test.ts`).
  - Skill composition matrix and clean separation of repository guidance (`AGENTS.md`) from portable skill bundles (`skills/*/`).
- **Dependency Modernization, CI Bootstrap Repair & Dogfooding Verification (Phase 6.2)**:
  - Fixed GitHub Actions pnpm bootstrap failure across Ubuntu and Windows matrix using `actions/setup-node@v4` with native `corepack enable` and `corepack prepare pnpm@11.1.0 --activate`.
  - Added automated dependency baseline checking tool (`scripts/check-deps.ts` / `pnpm deps:check`).
  - Added 14th canonical skill: `skills/dependencies/SKILL.md` (Monorepo dependency inventory, safe upgrades, lockfile integrity).
  - Implemented end-to-end generator dogfooding test suite (`scripts/dogfood-test.ts` / `pnpm test:dogfood`) testing scaffolding, metadata transforms, skill verification, and clean unpacked distribution.
  - Formalized permanent dependency upgrade policy (Rule 11) in `AGENTS.md`.
- **Developer Configuration Surface (`packages/config`)**:
  - `app-config.ts`: Application constants, metadata, pagination limits.
  - `auth-config.ts`: Authentication settings (`registrationEnabled`, `defaultIdentity`, `sessionTtlSeconds`, `cookieName`, `minPasswordLength`).
  - `iam-config.ts`: Declarative domain roles, groups, default policies, and baseline role-policy assignments.
  - `feature-config.ts`: Optional feature toggles (`enableSwagger`, `enableMetrics`, `enableStorage`, `enableRedis`, `enableEmail`).
- **Comprehensive Quality Gates & Testing Architecture**:
  - Multi-tier testing pyramid: unit tests, Fastify `app.inject()` integration tests, adversarial security tests, generator smoke tests, and packed tarball release verification (`pnpm verify:release`).
  - Coverage analysis with `@vitest/coverage-v8`.
  - GitHub Actions CI/CD workflows (`ci.yml` and `release.yml`).
