# Baseline

A full-stack application built with Next.js (App Router), Fastify, PostgreSQL (Drizzle ORM), Redis, S3-compatible storage, and a complete Identity & IAM Authorization System.

---

## 1. Quick Start

### Prerequisites
* **Node.js**: `>=22.13.0` (matches the `engines` field in package.json)
* **pnpm**: `>=11.1.0`
* **Docker & Docker Compose**: v2.x+ running on host

### Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infrastructure (PostgreSQL, Redis, MinIO, Prometheus, Grafana)
pnpm infra:up

# 3. Apply database migrations & seed baseline IAM
pnpm db:migrate
pnpm db:seed

# 4. Start development servers
pnpm dev
```

Your root account credentials were generated during scaffolding and written to
`.env` as `INITIAL_ROOT_EMAIL` / `INITIAL_ROOT_PASSWORD`. `pnpm db:seed` uses them to
bootstrap the ROOT identity.

Local storage uses `ghcr.io/coollabsio/minio:latest`, a community build of MinIO
that includes the `mc` client. Both storage services use this image because the
previous `minio/minio` and `minio/mc` images are no longer publicly pullable.
The `minio-init` service creates the configured bucket idempotently and remains
running with a bucket health check, so `docker compose up -d --wait` confirms
storage readiness and reports initialization failures.

To refresh the latest GHCR image without deleting your data:

```bash
docker compose pull minio minio-init
docker compose up -d --wait
```

The publisher's source and build process are available at
[coollabsio/minio](https://github.com/coollabsio/minio). The image checked for this
change runs server `RELEASE.2025-10-15T17-29-55Z` and client
`RELEASE.2025-08-13T08-35-41Z`; future pulls of `latest` may change these versions.
The newer community console provides object browsing; administration uses `mc`.

The opt-in storage regression creates its own disposable Docker network and
volume, tests initialization, bad credentials and S3 operations, then cleans up:
`RUN_STORAGE_SMOKE=true pnpm test packages/shared/src/storage/minio-compose.test.ts` on POSIX,
or `$env:RUN_STORAGE_SMOKE='true'; pnpm test packages/shared/src/storage/minio-compose.test.ts`
in PowerShell.

---

## 1a. Before Deploying

`.env` is generated with a unique `SESSION_SECRET` and root password, but the
infrastructure credentials are still development defaults. The API refuses to start with
`NODE_ENV=production` while any of them remain, and will list exactly what to change.

* Replace `DATABASE_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and set `REDIS_PASSWORD`.
* Set `TRUST_PROXY` if the API runs behind nginx, a load balancer, or Docker ingress.
  Leaving it unset makes every request appear to come from the proxy, which disables
  per-IP rate limiting.
* Set `NEXT_PUBLIC_API_URL` to the API origin the browser can reach.
* `BIND_ADDRESS` defaults to `127.0.0.1` so Docker services are not exposed to the
  network. Change it only deliberately.

---

## 2. Local Service Endpoints

| Service | URL | Description |
| :--- | :--- | :--- |
| **Frontend Web** | [http://localhost:3000](http://localhost:3000) | Next.js UI |
| **Backend API** | [http://localhost:3001](http://localhost:3001) | Fastify HTTP Gateway |
| **OpenAPI Docs** | [http://localhost:3001/api/docs](http://localhost:3001/api/docs) | Interactive Swagger UI |
| **Grafana** | [http://localhost:3002](http://localhost:3002) | Observability Dashboards |
| **MinIO Console** | [http://localhost:9001](http://localhost:9001) | S3 Object Storage Browser |

---

## 3. Configuration System (`packages/config`)

Configure application behavior in `packages/config/src/`:
* `app-config.ts`: Application constants and metadata.
* `auth-config.ts`: Authentication settings (registration enabled, session TTL, cookie name).
* `iam-config.ts`: Declarative roles, groups, default policies, and baseline role-policy assignments.
* `feature-config.ts`: Feature toggles (email, realtime, storage, observability, agent).

### AI Agent

A chat agent acts on behalf of the signed-in user. It calls the API through `fastify.inject()` with the caller's own session, so every route guard applies and it can never exceed the user's permissions. Read tools run immediately; write tools are staged as pending actions the user must confirm. Access is controlled by the `agent:use` and `agent:act` permissions. Set `ANTHROPIC_API_KEY` (plus optional `AGENT_MODEL`, `AGENT_MAX_TOOL_STEPS`) in `.env` to enable it. See `skills/agent/SKILL.md`.

---

## 4. Development Scripts

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Run web and API concurrently |
| `pnpm dev:api` | Run Fastify API in watch mode |
| `pnpm dev:web` | Run Next.js in development mode |
| `pnpm build` | Compile all packages and applications |
| `pnpm typecheck` | Run TypeScript verification across all packages |
| `pnpm test` | Run Vitest test suite |
| `pnpm lint` | Run linters across all packages |
| `pnpm db:migrate` | Apply pending Drizzle migrations |
| `pnpm db:seed` | Seed initial database records and bootstrap ROOT account |
| `pnpm infra:up` | Start Docker Compose infrastructure |
| `pnpm infra:down` | Stop Docker Compose infrastructure |
| `pnpm health` | Run infrastructure health check |

## Bulk demo data

After `pnpm db:seed`, run `pnpm db:seed:bulk` (needs `BULK_SEED_PASSWORD` or `SEED_DEMO_PASSWORD`) to load 300 member logins (`bulk.user0001@baseline.test` ... `bulk.user0300@baseline.test`, MEMBER role, mixed ACTIVE/SUSPENDED/DISABLED), 10 courts, membership history, and about 4,600 bookings with payments across the past 60 and next 14 days. It is deterministic and safe to re-run.
