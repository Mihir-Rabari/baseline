# TASKS_MIHIR.md

> Owner: Mihir (backend, database, business logic, integrations, deployment, complex frontend logic).
> Scoped for a single short event with two people (deadline and judging format still `[to be confirmed]`). Tasks are ordered by **priority tier**, not by time.
> **Priority order from the brief: (1) the booking engine, (2) the live owner dashboard**, then everything that feeds them.
> Rules that apply to every task (from `AGENTS.md`): tests for every behaviour (T1), regression tests for bugs (T2), adversarial tests for security-sensitive code (T3), `app.inject()` tests for every route (T4), no `console.log` in backend code, no raw `process.env` (use `getEnv()`), validate with Zod, **do not lower coverage thresholds**. Run `pnpm verify` before merging to `main`.

---

## 0. Priority tiers and cut line

| Tier | Meaning | Tasks |
| --- | --- | --- |
| **Tier 1** | The demo fails without it. Do these first, in the order listed. | M-01 to M-07, M-09, M-10, M-11, M-12, M-13 (public routes and lead basics), M-14, M-15 |
| **Tier 2** | Needed to cover every PDF scene, done right after Tier 1 | M-08 (social play), M-13 (quotes and convert), expiry reminders inside M-10, then M-16, M-17, M-19 |
| **Tier 3** | Only when Tier 1 and 2 are done | S-01 to S-09 (section 2) |

M-18 (bug fixing) is not a block of work: it is capacity you protect throughout. Every bug fixed gets a regression test.

**If you fall behind, cut in this order:** all of Tier 3 (S-09, S-06, S-05, S-04, S-03, S-02, S-01), then the quotes part of M-13, then M-08. **Never cut** M-05 to M-07 (booking engine), M-14 (dashboard) or M-11 (stock).

### Order of work and hand-offs to Khushi

| Step | Tasks | Hand-off to Khushi |
| --- | --- | --- |
| 1 | M-01, M-02 | Setup done together at the start |
| 2 | M-03, M-04 | **Publish the Zod types and push the seed** so she can switch pages to real data |
| 3 | M-05, M-06, M-07 | Availability and booking go live; tell her immediately |
| 4 | M-09, M-10 | Members and notifications go live |
| 5 | M-11, M-12 | Shop, then bar go live |
| 6 | M-13, M-14 | Public routes, CRM, then the dashboard go live |
| 7 | M-08 and Tier 2 items | as ready |
| 8 | M-15 to M-17, M-19 | Mocks off, deploy, verify, rehearse |

---

## 1. Tier 1 and Tier 2 tasks

### M-01: Schema and migrations

- **Depends on:** nothing. **Blocks:** everything.
- **Do:**
  1. Create `packages/db/src/schema/_columns.ts` and the module files `members.ts`, `courts.ts`, `shop.ts`, `bar.ts`, `finance.ts`, `crm.ts`, `hr.ts`, `notifications.ts` exactly as in ARCHITECTURE_AND_DATABASE.md section 5. Export from `packages/db/src/schema/index.ts`.
  2. Generate SQL for the new tables only (section 7 of that document) into `packages/db/drizzle/0002_courtos_domain.sql`.
  3. Hand-write `packages/db/drizzle/0003_courtos_constraints.sql`: `CREATE EXTENSION IF NOT EXISTS btree_gist`; sequences `member_code_seq`, `invoice_number_seq`, `order_number_seq`, `tab_number_seq`; exclusion constraints (`court_occupancies_no_overlap`, `bookings_member_no_overlap`, `staff_shifts` overlap, `leave_requests` approved overlap); CHECK constraints (`court_occupancies_shape`, discounts 0–100, `stock_qty >= 0`, `qty > 0`, `payments.amount_paise <> 0`, booking member-or-guest, invoice one-bill-to, lead phone-or-email, `to_date >= from_date`); deferred FKs.
  4. Register both files in `packages/db/drizzle/meta/_journal.json`.
- **Files:** `packages/db/src/schema/*.ts`, `packages/db/drizzle/0002_*.sql`, `0003_*.sql`, `meta/_journal.json`.
- **Tests (rule T5):** `packages/db/src/schema.courtos.test.ts` (runs only when `DATABASE_URL` is set, like the existing DB tests): after migrate, inserting two overlapping `court_occupancies` rows fails with SQLSTATE `23P01`; adjacent rows succeed; a 45-minute `BOOKING` occupancy fails the shape check; `stock_qty = -1` fails; second ACTIVE membership for one member fails.
- **Definition of done:** `pnpm infra:reset && pnpm infra:up && pnpm db:migrate` works on an empty database and is a no-op the second time; `pnpm db:studio` shows all 47 tables (14 old + 33 new); `pnpm typecheck` passes.

### M-02: Config, env, roles and permissions

- **Depends on:** M-01. **Blocks:** every route.
- **Do:**
  1. `packages/config/src/env.ts` and `.env.example`: add `CLUB_TIMEZONE` (default `Asia/Kolkata`). Add `NEXT_PUBLIC_USE_MOCKS=false` to `.env.example` for Khushi. Add a test in `packages/config/src/env.test.ts`.
  2. `packages/iam/src/catalog/permission-catalog.ts`: register the new namespaces (list in ARCHITECTURE_AND_DATABASE.md section 6) with `registerPermissions`. **Mirror them into `BASELINE_PERMISSIONS` in `packages/db/src/seed.ts`** (they are two lists).
  3. `packages/config/src/iam-config.ts`: add policies `MemberPolicy`, `FrontDeskPolicy`, `BarStaffPolicy`, `OwnerPolicy` and roles `MEMBER`, `FRONT_DESK`, `BAR_STAFF`, `OWNER` per API_CONTRACT.md section 0.4. Set `registration.defaultRole = 'MEMBER'`.
  4. Make sure `seed.ts` creates the roles and policies idempotently (it already loops over `IamConfig`; verify and extend if the loop does not cover new roles).
- **Tests (T3):** `packages/iam` tests: a MEMBER is denied `bookings:read` (all bookings) but allowed `bookings:read:self` only when `resourceOwnerId` equals their id; BAR_STAFF is denied `reports:read`; explicit deny still wins.
- **Definition of done:** `pnpm db:seed` twice yields the same row counts; `GET /api/v1/iam/permissions` lists the new permissions; new tests pass.

### M-03: Seed data for the demo

- **Depends on:** M-01, M-02.
- **Do:** create `packages/db/src/seed-courtos.ts`, called from `seed.ts`, idempotent (`onConflictDoNothing`/`DoUpdate` on `plans.code`, `court_types.code`, `courts.name`, `products.sku`, `menu_items` natural key via name, `bar_tables.name`). Seed: 3 plans with the table in PROJECT_OVERVIEW.md section 2.3; 4 court types and 8 courts; the Friday 18:00–22:00 social window; `system_settings` (`club.hours`, `booking.cancel_cutoff_hours`, `tax.rates`, `shop.delivery_fee_paise`); 30 products (3 with stock at or below reorder level, one with stock 1 for the demo); 25 menu items; 10 bar tables; one demo user per role (owner, desk, bar, member) with passwords read from new `SEED_DEMO_PASSWORD` in `.env.example` (never printed or committed); 5 employees; 40 members across tiers (some memberships ending in 3 and 20 days).
- **Test (T5):** run the seed twice and assert identical counts per table.
- **Definition of done:** a fresh `pnpm setup` gives a club you can click through; counts match the list above.

### M-04: Domain errors and shared contract types ← unblocks Khushi

- **Depends on:** M-01.
- **Do:**
  1. `apps/api/src/lib/domain-error.ts`: `class DomainError extends Error { constructor(public code: string, public statusCode: number, message: string, public details?: ErrorDetail[]) }`.
  2. In `apps/api/src/plugins/error-handler.ts` map `DomainError` to the standard `HttpErrorResponse` (with `requestId`, `timestamp`); map Postgres `23P01`, `23505`, `23514` to 409/409/400 as fallback.
  3. In `packages/validation/src/`: `plans.ts`, `members.ts`, `courts.ts`, `bookings.ts`, `shop.ts`, `bar.ts`, `crm.ts`, `finance.ts`, `hr.ts`, `reports.ts`, `notifications.ts` with the **request and response Zod schemas exactly matching API_CONTRACT.md** (use `IsoDateTimeOutSchema` for timestamps). Export types. Run `pnpm build` for packages so the web sees them.
  4. Push to `main` and tell Khushi.
- **Tests:** error-handler test for each mapping (400/409/422 shapes include `requestId`).
- **Definition of done:** `import { BookingSchema } from '@packages/validation'` works in `apps/web`; Khushi's mock JSON validates against the schemas (a throwaway script or test that parses the doc examples is enough).

### M-05: Time utilities and availability

- **Depends on:** M-01, M-03.
- **Do:**
  1. `apps/api/src/services/time.ts`: `clubDate(instant)`, `startOfClubDay(date)`, `clubDateOf(instant)`, `isSlotStart(instant)`, `isInOpeningHours`, `isInSocialWindow`, week/month ranges in club time. Use `Intl.DateTimeFormat` with `CLUB_TIMEZONE` (no new dependency).
  2. `apps/api/src/services/availability.service.ts`: builds the matrix of API_CONTRACT.md 5.1 from `courts`, `court_occupancies`, `bookings` (staff holder names), `social_sessions` (spots left), opening hours, and `PricingService` for the caller.
  3. Routes: `GET /api/v1/courts`, `GET /api/v1/courts/availability`, `GET /api/v1/public/availability`.
- **Files:** `apps/api/src/services/time.ts`, `availability.service.ts`, `apps/api/src/routes/v1/courts.ts`, `public.ts`, register in `routes/v1/index.ts`.
- **Tests:** unit tests for time helpers (including a date that crosses UTC midnight: 00:30 IST is the previous UTC day); availability marks 18:30 booked when 18:00–19:00 exists; social-mode courts return hourly slots with `spotsLeft`; `app.inject()` for 400/401/422 and success shape.
- **Definition of done:** the grid JSON matches the contract; Khushi can load it.

### M-06: PricingService

- **Depends on:** M-05.
- **Do:** `apps/api/src/services/pricing.service.ts` with `priceFor({ courtType, plan | null, kind })` returning `{ basePricePaise, discountPct, pricePaise }` using BR-05 (integer rounding, `round(base * (100 - pct) / 100)`), trial and social variants, and `resolveEntitlements(memberId, onDate)` returning the active plan or walk-in defaults (BR-07).
- **Tests:** table-driven: Gold 0, Silver 42000, Junior 30000, guest 60000, trial 19900, social Gold 0; expired membership gets walk-in price.
- **Definition of done:** all table cases pass.

### M-07: Booking engine

- **Depends on:** M-05, M-06, M-04.
- **Do:** `apps/api/src/services/booking.service.ts` implementing ARCHITECTURE_AND_DATABASE.md 3.1 and 3.2 and BR-01 to BR-09 precisely:
  - `create()`: validate start (`:00`/`:30`, within hours, not past), horizon, membership validity; one transaction with the advisory lock, daily count, insert occupancy then booking; map `23P01` to `SLOT_TAKEN` or `MEMBER_DOUBLE_BOOKED` **outside** the transaction.
  - `cancel()`: cutoff rule from `system_settings`, delete occupancy, set `cancelledLate`, refund payment row when paid, audit via `iamService.logAuditEvent`, override only for `bookings:override` with a reason.
  - `pay()`, `markNoShow()`, `complete()`.
  - Routes in `apps/api/src/routes/v1/bookings.ts` with `requirePermission` (and `:self` with `resourceOwnerId` = the member's `userId`).
  - Demo tool `POST /api/v1/demo/booking-race` (disabled when `NODE_ENV=production`).
- **Tests (T1–T4, the most important tests in the project):**
  - 20 parallel `app.inject()` creations for one slot give exactly one 201 and nineteen 409 `SLOT_TAKEN`.
  - Adjacent slots coexist; 18:30 overlaps 18:00; different courts coexist.
  - Same member, two courts, overlapping time: `MEMBER_DOUBLE_BOOKED`.
  - Daily limit: the third booking fails; **two concurrent bookings when one is already used: only one succeeds**; cancel early frees quota; cancel late does not.
  - Four prices for the same slot; price snapshot unchanged after a plan change.
  - Adversarial: member A cannot read or cancel member B's booking; member cannot pass another `memberId`; suspended user gets 403; non-slot start `INVALID_SLOT_START`.
  - Regression test for every bug found later (rule T2).
- **Definition of done:** all tests green; the demo-race endpoint prints `1 confirmed · 19 slot taken`.

### M-08: Friday social play · Tier 2

- **Depends on:** M-07.
- **Do:** `joinSocial()` in `booking.service.ts` per section 3.3 (upsert session, occupancy on first join, `FOR UPDATE` capacity count, daily limit and overlap checks); extend availability for social mode; refuse exclusive bookings in a window (`SOCIAL_WINDOW`); route `POST /api/v1/bookings/social/join`.
- **Tests:** capacity 8: the 9th join fails `SOCIAL_FULL`, including under 12 concurrent joins (exactly 8 succeed); a member cannot join twice; exclusive booking in the window fails; social joins count toward the daily limit; cancelling a participant reopens a spot; outside the window `NOT_A_SOCIAL_SLOT`.
- **Definition of done:** the grid shows "x of N left" updating after joins.

### M-09: Payments ledger and notifications

- **Depends on:** M-01.
- **Do:** `payment.service.ts` (`record({ source, sourceId, amount, method, memberId, receivedBy })` attaching the receiver's open `shiftId`; `refund()` writing a negative row; helper to sum paid for a source) and `notification.service.ts` (`notifyRole(roleNames, payload, dedupeKey)` fanning out one row per user with `onConflictDoNothing` on `dedupeKey`). Routes `GET /notifications`, `/notifications/unread-count`, `POST /notifications/:id/read`, `/read-all` (permissions `notifications:*:self`).
- **Tests:** refund creates a negative row and net is zero; the same dedupe key twice creates one notification per user; a user cannot read another's notification (403/404).
- **Definition of done:** the bell endpoints match the contract.

### M-10: Members, plans, memberships and expiry

- **Depends on:** M-06, M-09.
- **Do:**
  - `membership.service.ts`: `register()` (member + membership + PAID invoice + payment in one transaction; Junior age check from `plans.maxAge`; member code from `member_code_seq` as `CC-` + 6 digits), `renew()`, `lookup()`, `timeline()` (UNION of checkins, bookings, orders, tabs, invoices ordered by time), `checkin()`.
  - Derived fields `daysLeft` and `expiryState` computed at read time from `ends_on` and club date.
  - Minimal `invoice.service.ts` creating a PAID membership invoice (full invoice features are S-04).
  - Routes: `/plans`, `PUT /plans/:id`, `/members`, `/members/lookup`, `/members/:id`, `/members/:id/timeline`, `/members/:id/checkin`, `/members/:id/membership/renew`, `/me/member`.
  - `job.service.ts` with `runMembershipExpiry(asOf)` (mark EXPIRED after `ends_on`, create idempotent reminders at 30/7/1 days and on expiry through `membership_reminders` and notifications to the member's user and to FD), plus `POST /admin/jobs/membership-expiry`; start it from `apps/api/src/server.ts` on a 15-minute `setInterval` cleared on shutdown.
- **Tests:** register creates member, membership, PAID invoice and payment atomically (inject a failure in the middle and assert nothing persisted); Junior over 18 fails; second active membership fails; reminders created once even when the job runs three times; expiry flips status; `/me/member` returns 404 `NOT_A_MEMBER` for a fresh signup.
- **Definition of done:** registering a member from Swagger returns the contract's JSON; running the job with `asOf` set to the day after expiry marks the membership EXPIRED.

### M-11: Shop and inventory

- **Depends on:** M-04, M-09.
- **Do:** `shop.service.ts`: `quote()`, `placeOrder({ channel, ... })` as the **single path** for POS and online (section 3.4 guarded decrement, products locked in id order, `stock_movements`, low-stock notification once per crossing using `low_stock_alerted_at` + dedupe key, payment row for POS and for online `payNow`), `restock()`. Routes in `apps/api/src/routes/v1/shop.ts`: `/products*`, `/inventory/low-stock`, `/orders/quote`, `/orders/pos`, `/orders/online`, `GET /orders`, `GET /me/orders`, `GET /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/pay`. Public `GET /public/products` (no stock numbers beyond `inStock`).
- **Tests:** two concurrent buyers for the last unit: one 201 and one `OUT_OF_STOCK`; stock never negative after 30 random concurrent orders; member discount applied server-side and equals `quote()`; low-stock notification fires once and again only after restock then drop; guests cannot see staff-only fields; a member cannot mark another's order.
- **Definition of done:** selling the last shoe at the counter flips `inStock` false on `/public/products`.

### M-12: Bar POS

- **Depends on:** M-09, M-10 (member lookup).
- **Do:** `bar.service.ts`: `openTab()` (one open tab per table via partial unique index, mapping `23505` to `TABLE_OCCUPIED`), `addItem()` (price and member bar discount snapshot), `removeItem()`, `sendToKitchen()` (group `PENDING` items into one ticket per station), `settle()` (guarded `UPDATE … WHERE status='OPEN'`, freeze totals, payment rows by method, `received_by`, shift), `void()`, ticket status transitions, `earnings(date)`. Routes in `apps/api/src/routes/v1/bar.ts` for everything in API_CONTRACT.md section 7. Permissions `bar:*`.
- **Tests:** member tab shows a 5% discount, guest none; second tab on the same table is refused; send groups items and flags them SENT; settle twice returns `ALREADY_SETTLED` (also concurrently); totals frozen after settle; ticket cannot jump NEW to SERVED; earnings equal the sum of payments; BAR role cannot call `/reports/*` or `/payments`.
- **Definition of done:** the full flow (open, add, send, ready, settle) works from Swagger and shows in `/bar/earnings`.

### M-13: Public endpoints and CRM

- **Depends on:** M-05, M-07, M-09, M-10.
- **Do:** `crm.service.ts` (`createLead`, `updateLead`, `addActivity`, `createQuote`, `sendQuote`, `convert()` in one transaction with `SELECT … FOR UPDATE` on the lead: member + membership + PAID invoice + payment + `CONVERTED` activity), and the public routes in `public.ts`: `GET /public/club`, `/public/plans`, `/public/products`, `POST /public/enquiries`, `POST /public/trial-bookings` (reuses `BookingService` with `kind: 'TRIAL'`, creates a lead, notifies FD and OWN with `NEW_LEAD`), with per-route rate limits (30/min GET, 5/min POST). Routes `/crm/*` per API_CONTRACT.md section 9.
- **Tests:** enquiry creates a lead and notifications; one trial per phone (`TRIAL_ALREADY_USED`); trial on a taken slot gives `SLOT_TAKEN` and creates **no** lead; convert twice (also concurrently) gives `ALREADY_CONVERTED`; convert rolls back fully when the invoice step fails; public responses contain no member PII; rate limit returns 429 on the sixth POST.
- **Definition of done:** the Scene 5 flow works end to end from the browser (with Khushi's pages) or Swagger.

### M-14: Owner dashboard (live)

- **Depends on:** M-07, M-11, M-12, M-10. **This is a headline feature; protect this time.**
- **Do:** `report.service.ts` + `GET /reports/dashboard` and `GET /reports/export.csv` per API_CONTRACT.md section 11. All figures come from `payments` (net of refunds): `kpis`, `bySource`, `byMethod`, `trend` (hourly for today, daily otherwise), `owed` (tax computed from `tax.rates`, payroll from `employees`, unpaid from `invoices`), `alerts` (counts), and `utilisationPct` (booked hours over open court-hours so far). Use SQL `date_trunc` with `AT TIME ZONE` set to the club zone and indexes already defined on `payments`.
- **Tests:** a fixture with known payments across sources, modes and a refund gives exact totals; boundary at club midnight (23:30 IST payment lands on the club's day, not the UTC day); week starts Monday; BAR and FRONT_DESK get 403; response parses against `DashboardReportSchema`.
- **Definition of done:** making a booking payment, a POS sale and a tab settlement changes the dashboard JSON on the next call; p95 under 150 ms on seed data.

### M-15: Integration and review with Khushi

- **Depends on:** her pages. **Do:** give each of her PRs a quick review (design checklist, four states, no literal colours, lint and typecheck green); when a module is live, tell her; fix contract mismatches in the contract file first, then code; keep a shared list "ready endpoints" in the team chat. Run the app with mocks off from hour 28 onward.
- **Definition of done:** every page in UI_SPEC section 3 works against the real API with `NEXT_PUBLIC_USE_MOCKS=false`.

### M-16: Deployment · Tier 2

- **Depends on:** M-14 and a working build. **Note:** the repo has **no app Dockerfiles** (removed in `89a829e`) and `docker-compose.yml` is infrastructure only.
- **Choose the simplest path that gives a public URL** (state the choice in the README section you add):
  - **Option A (recommended): one small VM** (any provider you can get quickly) running Docker Compose for Postgres/Redis/MinIO and the apps via `pnpm build` + `node apps/api/dist/server.js` and `pnpm --filter @app/web start`, behind Caddy or nginx for HTTPS. **PROPOSED ADDITION:** a `deploy/` folder with `api.Dockerfile`, `web.Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`.
  - **Option B: demo from the laptop** (acceptable if the organisers allow): `pnpm build`, `pnpm start`-style run, plus a screen-recorded backup of the demo.
- **Production checklist (the API refuses to boot otherwise):** `NODE_ENV=production`; unique `SESSION_SECRET`; non-default `DATABASE_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `REDIS_PASSWORD`; `TRUST_PROXY` set; `NEXT_PUBLIC_API_URL` set **before building the web app** (it is baked into the bundle); `WEB_URL` and CORS origin set so the cookie works; serve web and API under the **same site** (for example `club.example.com` and `api.club.example.com`) so the `SameSite` session cookie is sent; run `pnpm db:migrate` and `pnpm db:seed` once.
- **Definition of done:** a phone on mobile data opens the public site, signs up, books a trial; `/health/ready` is green; a nightly-style backup command (`pg_dump`) is written down.

### M-17: Final verification

- Run `pnpm verify` (skills check, lint, typecheck, test, build). Run `pnpm test:coverage` and confirm thresholds are intact. Fix, do not weaken. Tag the release candidate commit.
- **Definition of done:** green `pnpm verify` on the commit that is deployed.

### M-18: Bug fixing (protected capacity)

- Always on. Every bug fixed gets a regression test (rule T2) before closing it. Keep a `docs/hackathon/KNOWN_ISSUES.md` list; anything unfixed goes there and gets a "won't demo" decision.

### M-19: Demo preparation

- Script from PROJECT_OVERVIEW.md section 9; a `pnpm demo:reset` alias (**PROPOSED:** root script running `pnpm infra:reset && pnpm infra:up && pnpm setup`) to restore a clean state quickly; verify the demo clock helpers (`asOf`) work; rehearse twice; record a backup video.
- **Definition of done:** a full demo and a short version, both rehearsed.

---

## 2. Tier 3 tasks (only when Tiers 1 and 2 are done)

| ID | Task | Depends | Definition of done |
| --- | --- | --- | --- |
| S-01 | Plan changes: upgrade with prorated top-up invoice, scheduled downgrade (`pending_plan_id`, applied by the expiry job at renewal), cancel at period end; `membership_events` rows; routes `change-plan` and `cancel` | M-10 | Upgrade creates invoice of the exact prorated amount; downgrade changes nothing until `ends_on`; events visible in the timeline |
| S-02 | Maintenance blocks (`POST/DELETE /courts/blocks`) and social-window admin (`/social-windows`) | M-07 | Blocking a booked slot returns `SLOT_TAKEN` with conflicting bookings listed |
| S-03 | Staff shifts: `/shifts` CRUD, clock in/out, `GET /me/shift/current`; `payments.shift_id` set automatically; `byShift` in earnings | M-12 | Earnings by shift sum to the day total |
| S-04 | Full invoices: `/invoices*`, `/business-clients*`, send/pay/void, `/finance/tax-summary`, `/payments` | M-09 | Invoice moves DRAFT to SENT to PAID when payments equal total; tax summary matches hand-calculated numbers |
| S-05 | HR: `/hr/employees`, `/hr/leave`, decision with overlap exclusion, `/me/leave`, `/hr/payroll-summary` | M-02 | Overlapping approval returns `LEAVE_OVERLAP`; payroll sums salaries |
| S-06 | Dashboard sharing: `/reports/shares` (store only SHA-256 token hash, like `SessionManager`), `/public/reports/shared/:token`, utilisation percent polish | M-14 | Revoked and expired tokens return `SHARE_LINK_INVALID`; the shared response has no PII |
| S-07 | Order lifecycle: cancel with stock return and refund, unpaid-online-order release job `POST /admin/jobs/release-unpaid-orders` | M-11 | Cancelling restores stock exactly and writes `CANCEL_RETURN` movements |
| S-08 | Notifications for `ONLINE_ORDER`, `KITCHEN_READY` (to the opener of the tab), `LEAVE_REQUEST`, `LEAVE_DECIDED` | M-09 | Each event creates the expected recipient rows |
| S-09 | History generator: 12 days of plausible payments, bookings and tabs so charts are not empty on first load (separate `pnpm db:seed:demo`) | M-03, M-14 | Dashboard week and month views show a believable trend |

---

## 3. Working agreements with Khushi

- **Contract first.** Any change to a response shape is edited in `API_CONTRACT.md` and announced before code.
- **Ping rhythm.** Message her at each hand-off in the timeline; unblocking her comes before your own task.
- **Branches:** `mihir/<topic>`, short-lived, squash-merge to `main` after `pnpm lint && pnpm typecheck && pnpm test` pass. Pull `main` before each task.
- **Commits:** Conventional Commits (`feat(booking): …`, `fix(shop): …`, `test(booking): …`).
- **Never** commit `.env`, demo passwords or tokens.
