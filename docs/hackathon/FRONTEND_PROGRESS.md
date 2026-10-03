# Frontend implementation status

Updated 3 October 2026. Latest main includes the reviewed court calendar (#36) and bookings/membership pages (#38); remaining workflows build on them. This records implementation and automated coverage separately from browser and live API acceptance.

| Tasks | Implementation | Acceptance remaining |
| --- | --- | --- |
| K-01–K-10 | Setup, shared components, navigation, plans, contact and members merged in earlier PRs | Final browser polish |
| K-11, K-12, K-16, K-23 | Inventory/restock, shop/cart, counter sales, member lookup and orders board | Browser light/dark and narrow-screen review |
| K-13–K-15, K-22, K-29 | Own bookings/membership, court calendar, social/trial booking, live landing proof and development race tool | Browser review; public horizon decision in #33 |
| K-17, K-18, K-21, K-24, K-30 | Bar floor/tabs, kitchen, earnings and notifications | Browser review; atomic line decrement endpoint in #34 |
| K-19, K-20, K-27, K-28 | Owner reports/charts/export, CRM follow-ups/quotes/conversion, shares and club settings | Share routes in #31, social-window routes in #35, browser review |
| K-25 | Invoice list/create/detail, print, send, payment and void | Invoice/business-client APIs in #32, browser review |
| K-26 | Employees, leave requests/decisions, payroll, roster and own clock-in/out | HR/shift APIs in #32, browser review |
| Dashboard role views | Owner, desk, bar and member summaries alongside account information | HR current-shift API and browser review |
| K-31 | Static token/theme, keyboard, responsive-layout and copy checks; automated DOM regression coverage | Browser inspection was rejected by the desktop browser security policy. Visual acceptance is pending. |

All new domain clients use the central `fetchApi` transport and shared validation contracts. Stateful mocks exercise stock, payments, booking conflicts/quotas, kitchen transitions and CRM conversion. `NEXT_PUBLIC_USE_MOCKS` remains a local, uncommitted development setting; missing endpoints do not silently fall back to mocks in real mode.

The public play picker follows the backend's two-day limit. Bar lines offer explicit **Add one** and **Remove line** actions until an atomic quantity update exists. Share mocks persist only mock link metadata locally and expose summary figures without obligations or attention alerts.

Issue #37 records a dashboard React warning observed during development hot reload; reproduction on a stable restart remains to be confirmed.

Validation passed for the integrated PR stack: `pnpm verify` with the Docker PostgreSQL URL exported. Skills checks, lint, typechecking, 1,026 passing tests (one skipped), and API/web production builds all passed. Individual PR descriptions record the result of the integrated gate. No dependency or generator changes were made.
