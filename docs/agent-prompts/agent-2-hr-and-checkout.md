# Agent 2 task: HR completeness, employee photos, POS and member checkout

You are working in `K:\Projects\baseline` (pnpm monorepo: Next.js web, Fastify API, Drizzle/Postgres). Read `AGENTS.md` first and obey it: every behaviour change needs tests (T1-T4), security-sensitive changes need adversarial tests (T3), never delete or weaken tests (T7), run `pnpm verify`-equivalent checks before saying done (T8). Use the skills in `skills/` that AGENTS.md maps to your task (api, validation, testing, security, frontend, design).

Start from latest `main` and work on a new branch `codex/agent2-<topic>`. Open one PR per topic below into `main`. Do not merge PRs that you did not open. Another agent works on other areas, so keep to the files each topic needs.

## Running the DB-backed tests (they silently skip otherwise)

```bash
docker run -d --name agent2-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=app_db -p 127.0.0.1:55434:5432 postgres:16-alpine
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:55434/app_db REDIS_URL=redis://localhost:6481 REDIS_PORT=6481
(cd packages/db && npx tsx src/migrate.ts && npx tsx src/seed.ts)
pnpm --filter "@packages/*" build
(cd apps/api && npx vitest run); (cd apps/web && npx vitest run); pnpm lint; (cd apps/api && npx tsc --noEmit); (cd apps/web && npx tsc --noEmit)
```

Never touch the `proofpay-postgres` container. If you add a migration, number it after the highest in `packages/db/drizzle`, add it to `meta/_journal.json`, and update the table/migration counts in `packages/db/src/schema.isolated.test.ts`. Page roots that start with a PageHeader must use `space-y-8`; lucide icons need `aria-hidden` and `h-4 w-4` (see `apps/web/src/lib/page-layout.test.ts` and `icon-conventions.test.ts`).

## Topic 1: shifts, staff and leave (issue #66)

Already on main: shifts CRUD with clock in/out and a calendar view, employees list/create/update, leave requests with owner decision, payroll runs and payslips (`apps/api/src/services/payroll.service.ts`, `/hr/payroll`).

Build what is missing:
1. **Shift swaps**: an employee proposes a swap of one of their shifts with a colleague; the colleague accepts or declines; the owner (`shifts:manage`) can approve or override. Both shifts change atomically; conflicts (the existing per-employee no-overlap constraint) must return a clear 409, not a 500. Notify the people involved (see `notification.service.ts`).
2. **Leave balances**: yearly allowance per leave type (add a settings key or a table; owner-editable), remaining balance on `GET /me/leave` and the employee list, and a 422 when a request exceeds the balance. Approved leave beyond the paid allowance should be suggested as unpaid days when a payroll run is created (`createRun` currently reads approved leave days but only records them; keep the owner's manual override).
3. **Staff directory**: edit employee details and deactivate or reactivate from the web (`apps/web/src/components/club/hr-workspace.tsx`); an inactive employee must be excluded from new payroll runs and shift assignment (add the checks and tests).
4. Tests for each flow with `app.inject()`: 400, 401, 403, success shapes, plus adversarial cases (an employee cannot swap or read someone else's shifts, cannot decide their own leave, cannot see payroll or bank data).

## Topic 2: employee profile and photo (issues #65 and #80)

1. Add `photo_url` to employees (migration), expose it in the employee schemas (`packages/validation/src/hr.ts`) using `ImageRefSchema` from `uploads.ts` (only our uploads or https links), and set it through the existing upload endpoint `POST /api/v1/uploads/employee` (needs `hr:manage`) with the reusable `ImageUploader` component. Court photos and the club logo are already done the same way (see `apps/api/src/image-fields.test.ts`).
2. Employee profile screen in the web app: details, photo, department, salary, status, leave summary, link to bank details (`/hr/employees/:id/bank`, masked) and payslips. Bank details must stay masked everywhere and never be logged.
3. Tests, including that non-owners get 403 on the bank and photo endpoints.

## Topic 3: payment dialogs for POS and member bookings (issues #67 and #68)

Already on main: the shared `PaymentDialog` and `PaymentMethodPicker` in `apps/web/src/components/club/payment-dialog.tsx`, guest checkout at `/play` (`POST /public/bookings`, UPI/card in full, cash = 20% promise fee), shop checkout, and API rules for members (UPI/card in full; cash on a member booking pays the promise fee).

Build:
1. The counter-sale (POS) page `apps/web/src/app/(app)/pos/page.tsx`: use the shared dialog for UPI/card/cash at the till, and show a receipt after the sale (order number, lines, discount, total, method, printable).
2. The logged-in member booking flow (the `/courts` page, `apps/web/src/app/(app)/courts/page.tsx`): after choosing a slot, show the payment dialog; cash shows the promise fee and the amount due at the club.
3. A booking that is partly paid (`paymentStatus: 'PARTIAL'`) must show "Paid X, due Y" wherever bookings are listed.
4. Tests for each page, mocking the API client like the existing page tests do.

## Definition of done

- All three PRs open against `main` with lint, typecheck and every suite green against a real database.
- For each GitHub issue you finish, comment what was delivered and close it. Leave an issue open with a progress comment if anything on its checklist is not done (issues #65, #66, #67, #68, #80).
- Do not touch issue #69 (multi-tenancy) or the pages Khushi owns (landing page, profile page, IAM admin screens) beyond what a topic requires.
- Report back with the three PR links and anything you chose not to do.
