# TECH_STACK.md

> Documented **from the repository** (`K:\Projects\baseline`, branch `main`). Versions are the resolved versions in `pnpm-lock.yaml` / `node_modules` where known, with the declared range in brackets. Nothing here is invented. Anything we would add is labelled **PROPOSED ADDITION** with a reason.
> Read `AGENTS.md`, `apps/web/AGENTS.md`, `apps/api/AGENTS.md`, `skills/design/SKILL.md` and `skills/frontend/SKILL.md` before writing code. They are the repo's own law.

---

## 1. Stack as configured

| Layer | Technology | Version (declared) | Used for in CourtOS |
| --- | --- | --- | --- |
| Monorepo | pnpm workspaces | 11.1.0 (`packageManager`) | `apps/*` and `packages/*`; frozen lockfile in CI |
| Runtime | Node.js | `>=22.13.0` (`engines`; this laptop runs 24.15) | API and tooling |
| Language | TypeScript | 5.9.3 (`^5.7.3`), ESM (`"type": "module"`) | Everywhere |
| Frontend framework | Next.js (App Router, webpack mode) | 16.3.8 (`^16.3.8`) | `apps/web` |
| UI runtime | React | 19.3.0 (`^19.0.0`) | Components |
| Styling | Tailwind CSS (v3, class dark mode) | 3.4.19 (`^3.4.17`) | All styling; tokens in `globals.css` |
| UI components | shadcn-style components on Radix UI | Radix 1.x/2.x, `components.json` present | `apps/web/src/components/ui/*` |
| Icons | lucide-react | 0.475.0 | Sidebar and structural icons only (see design skill) |
| Class helpers | clsx, tailwind-merge, class-variance-authority | 2.1.1, 3.x, 0.7.1 | `cn()` in `@/lib/utils` |
| Server state | TanStack Query | 5.104.0 (`^5.66.9`) | All API reads, polling (`refetchInterval`) |
| Forms | react-hook-form + `@hookform/resolvers` | 7.89.0, 4.1 | Every form, with Zod schemas |
| Toasts | sonner | 2.0.8 | `@/components/ui/sonner` |
| Theming | next-themes | 0.4.6 | Light/dark toggle |
| Validation | Zod | 3.25.76 (`^3.24.2`, **v3 API**) | Shared in `packages/validation`; used by web and API |
| Backend framework | Fastify | 5.12.5 (`^5.2.1`) | `apps/api` |
| Type provider | fastify-type-provider-zod | 4.0.2 | Typed routes from Zod |
| API plugins | @fastify/cookie, cors, helmet, rate-limit, sensible, swagger, swagger-ui | see `apps/api/package.json` | Session cookie, CORS, headers, throttling, OpenAPI at `/api/docs` |
| Logging | pino (via `@packages/shared` logger) | 9.6 | Structured logs, request ids |
| Metrics | prom-client | 15.1 | `/metrics` |
| Database | PostgreSQL | 17 (`postgres:17-alpine` in `docker-compose.yml`) | System of record |
| ORM | Drizzle ORM | 0.45.3 (`^0.45.2`) | Schema in `packages/db/src/schema/*.ts` |
| Migrations | drizzle-kit | 0.31.11 | Hand-written SQL in `packages/db/drizzle/` (see section 6) |
| DB driver | postgres (postgres.js) | 3.4.9 | Connection pool in `packages/db/src/client.ts` |
| Cache / sessions | Redis (`ioredis`) | 5.11.1; image `redis:alpine` | Session cache; `getClient()` for extras |
| Object storage | MinIO (S3 API, `@aws-sdk/client-s3`) | image pinned in compose | `StorageService` (member photos, product images) |
| Email | Resend (optional) | `RESEND_API_KEY` | Off by default (`FeatureConfig.enableEmail: false`) |
| Auth | Server-side sessions, scrypt hashing, HTTP-only cookie `app_session` | `packages/auth` | Login, signup, session |
| Authorization | Custom IAM policy engine | `packages/iam` | `requirePermission()` route guards, `:self` rules |
| Tests | Vitest | 3.2.7 | API (`app.inject()`), packages, web (Testing Library, jsdom) |
| Lint | ESLint 9 flat config + typescript-eslint | 9.39 | `--max-warnings 0` in web and API |
| Infra | Docker Compose | v2 | Postgres, Redis, MinIO, Prometheus, Grafana |
| Observability | Prometheus + Grafana | latest images | Optional for the demo |

**Not in the repo (do not assume they exist):** app Dockerfiles (removed in commit `89a829e`), a chart library, a calendar or date picker, a table library (TanStack Table), a job scheduler, WebSockets, a payment gateway, PDF generation.

---

## 2. Folder structure

```text
baseline/
├── AGENTS.md, README.md, CHANGELOG.md   Repo law, setup, history
├── package.json, pnpm-workspace.yaml    Root scripts and workspace globs
├── docker-compose.yml                   Infrastructure only (Postgres, Redis, MinIO, Prometheus, Grafana)
├── .env.example  /  .env (gitignored)   Environment template / your local values
├── vitest.config.ts, eslint.config.js   Shared test and lint config (coverage thresholds live here)
├── apps/
│   ├── api/                             Fastify backend (port 3001)
│   │   └── src/
│   │       ├── app.ts, server.ts        App builder and entrypoint
│   │       ├── plugins/                 config, auth, iam, cors, helmet, rate-limit, swagger, metrics, services, error-handler
│   │       ├── routes/health.ts         /health probes
│   │       ├── routes/v1/               Versioned routes: system, auth, iam, profile → CourtOS modules go here
│   │       ├── schemas/                 Route-local Zod schemas
│   │       ├── services/                Service classes (health.service.ts today)
│   │       └── test-support/database.ts Test DB helper
│   └── web/                             Next.js frontend (port 3000)
│       └── src/
│           ├── app/(marketing)/         Public site: layout.tsx, page.tsx → website pages go here
│           ├── app/(auth)/              login, signup
│           ├── app/(app)/               Signed-in shell (sidebar, topbar, auth guard): dashboard, profile, admin/iam
│           ├── components/ui/           shadcn components: alert, avatar, badge, button, card, dialog, dropdown-menu, input, label, select, separator, skeleton, sonner, switch, table, tabs, theme-toggle, tooltip
│           ├── components/app-shell/    sidebar.tsx, topbar.tsx, page-header.tsx, empty-state.tsx
│           ├── components/marketing/    site-header.tsx
│           ├── contexts/auth-context.tsx  useAuth(): user, hasPermission(), login, logout
│           ├── hooks/                   use-auth, use-health, use-iam (TanStack Query hook pattern)
│           └── lib/                     api-client.ts (typed fetch wrapper), errors.ts, utils.ts (cn)
├── packages/
│   ├── auth/                            scrypt, SessionManager, cookie helpers, login throttle
│   ├── iam/                             PermissionCatalog, PolicyEngine, IamService, route guards
│   ├── db/                              Drizzle schema (`src/schema/`), client, migrate.ts, seed.ts, SQL migrations (`drizzle/`)
│   ├── config/                          env.ts (`getEnv()`), app-config.ts, auth-config.ts, iam-config.ts, feature-config.ts
│   ├── validation/                      Shared Zod schemas, pagination, HTTP error schemas
│   ├── shared/                          Redis client, StorageService, logger, scrypt `password.ts`, response types
│   └── openapi/                         OpenAPI builder, tags, `CookieAuth` scheme
├── infrastructure/docker/               Prometheus and Grafana provisioning
├── scripts/                             setup.ts (+ .sh/.ps1/.cmd), health-check.ts, check-skills.ts, pack-skills.ts, check-deps.ts
├── skills/                              16 Agent Skills (read `design`, `frontend`, `api`, `database`, `testing`, `authorization`)
└── docs/hackathon/                      These documents
```

**Where new CourtOS code goes (follows the existing layout):**

| New thing | Location |
| --- | --- |
| Drizzle tables | `packages/db/src/schema/<module>.ts`, exported from `schema/index.ts` |
| SQL migration | `packages/db/drizzle/0002_<name>.sql` plus an entry in `drizzle/meta/_journal.json` |
| Zod request/response schemas | `packages/validation/src/<module>.ts`, exported from `index.ts` |
| Business logic | `apps/api/src/services/<module>.service.ts` |
| Routes | `apps/api/src/routes/v1/<module>.ts`, registered in `routes/v1/index.ts` |
| Permissions | `packages/iam/src/catalog/permission-catalog.ts` (register) **and** `BASELINE_PERMISSIONS` in `packages/db/src/seed.ts` (see section 6) |
| Roles/policies | `packages/config/src/iam-config.ts` |
| API client methods | `apps/web/src/lib/api-client.ts` (add a namespace per module) |
| Query hooks | `apps/web/src/hooks/use-<module>.ts` |
| Pages | `apps/web/src/app/(app)/<route>/page.tsx` (staff/member), `(marketing)/<route>/page.tsx` (public) |
| Mock JSON (Khushi) | `apps/web/src/mocks/<module>.json` **(PROPOSED convention, no new library)** |

---

## 3. Environment variables (names and purpose; no secrets)

Parsed once by `getEnv()` in `packages/config/src/env.ts`. Never re-parse `process.env` (AGENTS.md Rule 7).

| Variable | Purpose |
| --- | --- |
| `APP_NAME`, `NODE_ENV`, `LOG_LEVEL` | App name, mode, pino level |
| `WEB_URL`, `API_URL`, `PORT`, `HOST` | Service URLs (web 3000, API 3001) |
| `NEXT_PUBLIC_API_URL` | API origin used by the **browser** bundle (defaults to `http://localhost:3001`) |
| `TRUST_PROXY` | Proxy handling for rate limiting behind a load balancer (needed in deployment) |
| `DATABASE_URL`, `DATABASE_HOST/PORT/USER/PASSWORD/NAME`, `DATABASE_SSL` | PostgreSQL |
| `REDIS_URL`, `REDIS_HOST/PORT/PASSWORD` | Redis |
| `S3_ENDPOINT/PORT/REGION/ACCESS_KEY/SECRET_KEY/BUCKET/USE_SSL/FORCE_PATH_STYLE` | MinIO/S3 |
| `RESEND_API_KEY`, `RESEND_FROM` | Optional email |
| `SESSION_SECRET`, `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS` | Session security (API refuses production boot with defaults) |
| `INITIAL_ROOT_EMAIL`, `INITIAL_ROOT_PASSWORD` | ROOT bootstrap by `pnpm db:seed` |
| `BIND_ADDRESS` | Docker port binding (loopback default) |
| `PROMETHEUS_URL/PORT`, `GRAFANA_PORT/ADMIN_USER/ADMIN_PASSWORD/ANONYMOUS`, `MINIO_CONSOLE_PORT` | Observability and consoles |

**PROPOSED ADDITIONS (small, needed by the PDF):** add to `packages/config/src/env.ts` and `.env.example`:

| Variable | Why |
| --- | --- |
| `CLUB_TIMEZONE` (default `Asia/Kolkata`) | "Per day", "today", "Friday night" and the 2-per-day limit all depend on the club's local day |
| `NEXT_PUBLIC_USE_MOCKS` (`true`/`false`) | Lets Khushi build against mock JSON and flip to the real API with one variable |

---

## 4. Local setup (both laptops)

**Prerequisites:** Node 22.13+ (22 LTS recommended; 24 works), Docker Desktop running, Git.

```bash
corepack enable
corepack prepare pnpm@11.1.0 --activate
git clone <repo-url> baseline
cd baseline
pnpm install
cp .env.example .env      # Mihir shares his .env privately (never commit it); defaults work locally
pnpm infra:up             # Postgres, Redis, MinIO, Prometheus, Grafana
pnpm setup                # migrate + seed (idempotent)
pnpm dev                  # web on :3000, api on :3001
```

| Check | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API health | http://localhost:3001/health |
| API docs (Swagger) | http://localhost:3001/api/docs |
| MinIO console | http://localhost:9001 |

Daily commands (always from the repo root): `pnpm dev`, `pnpm dev:web`, `pnpm dev:api`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:studio`, `pnpm verify`.

### First-day setup checklist for Khushi

- [ ] Install Node, enable pnpm via corepack, install Docker Desktop and start it.
- [ ] Clone the repo and run `pnpm install`.
- [ ] Copy `.env.example` to `.env`; paste the `INITIAL_ROOT_EMAIL` and `INITIAL_ROOT_PASSWORD` values Mihir sends you (they are gitignored).
- [ ] `pnpm infra:up`, then wait for the containers to be healthy (`docker ps`).
- [ ] `pnpm setup`, then `pnpm dev`.
- [ ] Open http://localhost:3000, click Log in, sign in as root. You should see the dashboard.
- [ ] Open `apps/web/src/app/(app)/dashboard/page.tsx` and change the page description text. Watch it hot reload. Revert.
- [ ] Create your branch: `git checkout -b khushi/layout`. Run `pnpm lint` and `pnpm typecheck`; both must pass before you push anything.
- [ ] Read `skills/design/SKILL.md` sections 1 to 4.

---

## 5. Which installed library for which UI need

| UI need | Use (already installed) | One-line example | Gap? |
| --- | --- | --- | --- |
| Buttons, cards, badges, alerts | `@/components/ui/button`, `card`, `badge`, `alert` | `<Button variant="outline" size="sm">Edit</Button>`; `<Badge variant="warning">Expiring</Badge>` | none |
| Data tables | `@/components/ui/table` (plain styled HTML table) | `<Table><TableHeader>…</TableHeader><TableBody>{rows.map(r => <TableRow key={r.id}>…)}</TableBody></Table>` | No sorting/paging helper. Do client-side `Array.sort` and the API `page`/`limit` params. Enough. |
| Forms and validation | `react-hook-form` + `@hookform/resolvers/zod` + shared Zod schemas from `@packages/validation` | `const form = useForm({ resolver: zodResolver(Schema) })` | `Textarea`, `Checkbox` components not yet in `ui/`; add with `npx shadcn@latest add textarea checkbox` (uses `components.json`) |
| Modals | `@/components/ui/dialog` | `<Dialog open={open} onOpenChange={setOpen}><DialogContent>…</DialogContent></Dialog>` | none |
| Tabs (Today/Week/Month, status filters) | `@/components/ui/tabs` | `<Tabs value={range} onValueChange={setRange}><TabsList>…</TabsList></Tabs>` | none |
| Selects | `@/components/ui/select` | `<Select value={v} onValueChange={set}>…</Select>` | none |
| Toasts | `sonner` through `@/components/ui/sonner` | `import { toast } from 'sonner'; toast.success('Booked')` | none |
| Loading, empty, error | `Skeleton`, `EmptyState` (`app-shell/empty-state.tsx`), `Alert` | `if (isLoading) return <Skeleton className="h-40" />` | none |
| Page headings | `PageHeader` | `<PageHeader title="Members" description="…" actions={<Button>Add</Button>} />` | none |
| Data fetching and polling | TanStack Query | `useQuery({ queryKey:['slots',date], queryFn, refetchInterval: 10000 })` | none |
| Permission-aware UI | `useAuth().hasPermission('bookings:read')` | `{hasPermission('reports:read') && <Link …/>}` | none |
| **Slot grid (courts × times)** | No library needed: build with Tailwind CSS grid and `Button` | `<div className="grid" style={{gridTemplateColumns:`120px repeat(${courts.length},1fr)`}}>` | **Custom component**; see TASKS_KHUSHI |
| **Date selection** | Native `<Input type="date">` (`ui/input`) | `<Input type="date" value={date} onChange={…} />` | **PROPOSED ADDITION (optional):** `date-fns` for date math. Not required: `Intl.DateTimeFormat` and `Date` cover it. |
| **Charts** | **None installed** | n/a | **PROPOSED ADDITION: `recharts`** (React 19-compatible, declarative). Required for the dashboard (DSH-4, DSH-2, DSH-3). Reason: the PDF's owner dashboard needs charts and building SVG charts by hand costs hours. Run `pnpm --filter @app/web add recharts`; then `pnpm install` for the other laptop. Fallback if it misbehaves: CSS bar charts using Tailwind `div` widths (acceptable for revenue-by-source). |
| Printing invoices | Browser print + Tailwind `print:` variants | `<Button onClick={() => window.print()}>Print</Button>` | none |
| CSV download | Plain `<a href="…/export.csv">` pointing at the API | n/a | none |
| Mock data | Import JSON (`resolveJsonModule` is enabled) | `import slots from '@/mocks/slots.json'` | **PROPOSED convention** (section 7 of TASKS_KHUSHI) |

**Design tokens are the only allowed colours** (`bg-primary`, `text-muted-foreground`, `text-success`, `text-warning`, `text-destructive`). Never `bg-indigo-600` or emoji: `skills/design/SKILL.md` forbids it and `pnpm lint` does not catch it, but reviewers will.

---

## 6. Repo conventions

**Naming and structure**

| Area | Convention (seen in the repo) |
| --- | --- |
| Files | `kebab-case.ts`; React components `kebab-case.tsx` exporting `PascalCase` |
| DB columns | `snake_case` in SQL, `camelCase` in Drizzle (`passwordHash: varchar('password_hash')`) |
| Tables | plural `snake_case` (`users`, `user_roles`) |
| Enums | `varchar` + `$type<…>()` union, **not** Postgres enums (adding a value needs no migration) |
| Keys | `uuid('id').defaultRandom().primaryKey()`; timestamps `timestamp(…, { withTimezone: true }).defaultNow().notNull()` |
| Permissions | `namespace:action`, self-scope `namespace:action:self` (e.g. `profile:read:self`) |
| API paths | `/api/v1/<module>/…`, responses are **bare objects** (no `{success,data}` wrapper); lists are arrays or `{ data, meta }` when paginated |
| API errors | `HttpErrorResponse`: `{ statusCode, error, message, code, requestId?, details?, timestamp? }` |
| Imports | ESM with `.js` suffix inside packages and API (`from './auth.js'`); `@/` alias in web |
| Logging | `createLogger` from `@packages/shared`; **no `console.log`** in backend code (AGENTS.md section 5) |
| Env | `getEnv()` from `@packages/config`, never raw `process.env` |

**Quality rules (AGENTS.md section 3)**

- Every new behaviour needs automated tests; every bug fix needs a regression test; API routes are tested with `app.inject()` for 400, 401, 403 and success; security changes need adversarial tests.
- `pnpm lint` runs `eslint --max-warnings 0`: **zero warnings allowed**.
- Coverage thresholds in `vitest.config.ts` must not be lowered.
- Run `pnpm verify` before declaring any task complete.

**Hackathon relaxation (our decision, to be honest about it):** Mihir runs the full `pnpm verify` before every merge to `main` and the engine tests are mandatory (booking, pricing, stock, tabs, conversion). Khushi runs `pnpm lint` and `pnpm typecheck` before every push; Mihir runs `pnpm verify` when merging her branches. We do **not** lower thresholds or delete tests.

**Commits and branches**

- Commit messages follow Conventional Commits, as in the history: `feat: …`, `chore(docker): …`. Use `feat(booking): …`, `fix(shop): …`, `docs: …`. Commit attribution lines are defined by the tooling you use.
- **PROPOSED branch rules (the repo has none yet):** `main` is always demo-able; work on `mihir/<topic>` and `khushi/<topic>`; open a pull request, the other person gives it a quick look, then squash-merge. Never force-push `main`. Pull `main` before starting each task.

**Gotchas found while reading the repo**

1. **Permissions live in two places.** `packages/iam/src/catalog/permission-catalog.ts` (runtime registry) and `BASELINE_PERMISSIONS` in `packages/db/src/seed.ts` (inserted into the `permissions` table, `onConflictDoNothing`). Add every new permission to both or the admin UI will not list it.
2. **Migrations are hand-written SQL.** `packages/db/drizzle/` has `0000`/`0001` plus `meta/_journal.json` but **no snapshot files**, so `drizzle-kit generate` may try to recreate everything. Plan: write `0002_*.sql` by hand, add a journal entry, keep the Drizzle schema in sync. Mihir verifies this in the first hour (TASKS_MIHIR T-01).
3. **No app Dockerfiles in the repo** (removed in the latest commit). Deployment needs either a new Dockerfile (PROPOSED ADDITION, T-24) or running `pnpm build` and `node` on a VM.
4. `SESSION_SECRET` and DB/S3 passwords must be changed for `NODE_ENV=production` or the API will refuse to boot.
5. Redis is wrapped as `IRedisService` (get/set/delete/exists); there is no pub/sub wrapper. We use polling, not pub/sub.
6. The theme is **Zinc & Emerald** with IBM Plex Sans/Mono (tokens in `apps/web/src/app/globals.css`).
7. Documents in `skills/` are validated by `pnpm skills:check`; do not edit them casually.
