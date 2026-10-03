# API_CONTRACT.md

> The contract Khushi mocks against and Mihir implements. Follows the conventions already in `apps/api` (Fastify + Zod type provider, `/api/v1` prefix, bare JSON responses, `HttpErrorResponse` errors, cookie sessions, `requirePermission` guards). Response shapes below are **exact**: change them only by editing this file first and telling the other person.
> Implementation location for each module: `apps/api/src/routes/v1/<module>.ts`; Zod schemas in `packages/validation/src/<module>.ts` (so web and API share types); web methods in `apps/web/src/lib/api-client.ts` under `api.<module>`.

---

## 0. Conventions

### 0.1 Base, auth, format

| Topic | Rule |
| --- | --- |
| Base URL | `http://localhost:3001/api/v1` (web uses `API_BASE_URL` from `api-client.ts`) |
| Auth | HTTP-only cookie `app_session` set by `POST /auth/login` (existing). The web client already sends `credentials: 'include'`. |
| Success body | **Bare JSON** (no `{success,data}` wrapper), exactly as `GET /profile` does today |
| Paginated list | `{ "data": [...], "meta": { page, limit, totalItems, totalPages, hasNextPage, hasPrevPage } }` using `PaginationQuerySchema` (`page` default 1, `limit` default 20 max 100, `sort`, `order`) |
| Small lists | Plain arrays (plans, courts, tables, menu) |
| Ids | UUID strings. Example ids below use the pattern `…-0001`. |
| Money | Integer **paise** in fields ending `Paise` (₹420 = `42000`). The UI formats with `Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' })` and divides by 100. |
| Instants | ISO 8601 UTC strings: `"2026-10-09T12:30:00.000Z"` (18:00 IST). |
| Business dates | `"YYYY-MM-DD"` in the **club time zone** (`Asia/Kolkata`), fields named `...Date`, `date`, `...On`. |
| Percentages | Integers 0–100, fields ending `Pct`. |
| Request ids | Every response carries `x-request-id`; error bodies include `requestId`. |
| Docs | Each route registers a Zod schema, so it appears in Swagger at `/api/docs`. |

### 0.2 Error body (existing `HttpErrorResponseSchema`)

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "That court is already booked for this time.",
  "code": "SLOT_TAKEN",
  "requestId": "req_1738800000000_ab12cd3",
  "details": [{ "field": "startsAt", "message": "Court is busy 18:00–19:00", "code": "OVERLAP" }],
  "timestamp": "2026-10-09T12:00:00.000Z"
}
```

Standard codes: `400 VALIDATION_ERROR` (with `details`), `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `429 RATE_LIMITED`, `500 INTERNAL_SERVER_ERROR`. Domain codes (always `message` is human-readable, UI shows it in a toast or inline):

| Code | Status | Meaning |
| --- | --- | --- |
| `SLOT_TAKEN` | 409 | Court overlaps an existing booking, social session or block (BR-03) |
| `MEMBER_DOUBLE_BOOKED` | 409 | Member already has an overlapping session on another court |
| `SOCIAL_FULL` | 409 | Social session is at capacity |
| `SOCIAL_WINDOW` | 409 | Exclusive booking attempted inside a social window (or the court-hour is held) |
| `NOT_A_SOCIAL_SLOT` | 422 | Join attempted outside a social window or off the hour |
| `INVALID_SLOT_START` | 422 | Start not on :00 or :30, outside opening hours, or in the past |
| `DAILY_LIMIT_REACHED` | 422 | Member already has 2 bookings that day (BR-04) |
| `BEYOND_BOOKING_HORIZON` | 422 | Too far ahead for the plan (BR-06) |
| `MEMBERSHIP_EXPIRES_BEFORE_SLOT` | 422 | Membership ends before the session date (BR-07) |
| `TRIAL_ALREADY_USED` | 409 | Phone already used a trial |
| `CANCEL_NOT_ALLOWED` | 409 | Booking already cancelled, completed or in the past |
| `OUT_OF_STOCK` | 409 | Requested quantity exceeds stock (`details` lists products) |
| `ORDER_STATE_INVALID` | 409 | Illegal status transition |
| `TABLE_OCCUPIED` | 409 | Table already has an open tab |
| `ALREADY_SETTLED` | 409 | Tab already settled |
| `TAB_EMPTY` | 422 | Settle or send with nothing to bill |
| `ALREADY_CONVERTED` | 409 | Lead already converted |
| `QUOTE_STATE_INVALID` | 409 | Quote is expired or the requested transition is invalid |
| `QUOTE_INVALID` | 422 | Conversion quote is not accepted, is expired, or belongs to another lead or plan |
| `PHONE_REQUIRED` | 422 | Email-only lead needs a phone number before conversion |
| `JUNIOR_AGE_INVALID` | 422 | Date of birth not valid for the plan (age rule) |
| `MEMBER_HAS_ACTIVE_MEMBERSHIP` | 409 | Cannot create a second active membership |
| `LEAVE_OVERLAP` | 409 | Overlaps approved leave |
| `SHARE_LINK_INVALID` | 404 | Share token unknown, revoked or expired |
| `TAB_NOT_OPEN` | 409 | Bar tab is settled or void, so items cannot change |
| `ITEM_UNAVAILABLE` | 409 | Menu item is switched off (`isAvailable: false`) |
| `ITEM_ALREADY_VOID` | 409 | Tab item was already removed |

### 0.3 Roles legend (used in every table)

| Tag | Meaning | Source |
| --- | --- | --- |
| **PUB** | No login | `/public/*` routes |
| **MEM** | Logged-in `MEMBER`, self data only (`:self` permissions, `resourceOwnerId` = their user id) | new role |
| **FD** | `FRONT_DESK` | new role |
| **BAR** | `BAR_STAFF` | new role |
| **OWN** | `OWNER` | new role |
| **ANY** | Any logged-in user | existing |

`ROOT` and `ADMIN` can call everything OWN can. Suspended/disabled users get 403 everywhere (existing rule 10). A route that lists `FD, OWN` returns 403 for everyone else and 401 when logged out.

### 0.4 Role bundles (policies to add to `packages/config/src/iam-config.ts`)

| Role | Permissions |
| --- | --- |
| `MEMBER` | `profile:*:self`, `notifications:*:self`, `bookings:{read,create,cancel}:self`, `orders:{read,create,cancel}:self`, `leave:*:self` not granted (members are not staff) |
| `FRONT_DESK` | `members:{read,create,update}`, `memberships:{create,update}`, `plans:read`, `courts:read`, `bookings:{read,create,cancel}`, `products:read`, `inventory:{read,adjust}`, `orders:{read,create,update}`, `crm:{read,manage}`, `invoices:{read,create}`, `payments:create`, `shifts:read`, `shifts:clock:self`, `leave:{read,create}:self`, `notifications:*:self`, `profile:*:self` |
| `BAR_STAFF` | `members:read` (lookup only), `bar:{read,manage,kitchen,settle}`, `shifts:read`, `shifts:clock:self`, `leave:{read,create}:self`, `notifications:*:self`, `profile:*:self` |
| `OWNER` | everything above plus `plans:update`, `courts:update`, `products:{create,update}`, `bookings:override`, `invoices:update`, `payments:read`, `hr:{read,manage}`, `leave:{read,decide}`, `reports:{read,share}`, `shifts:manage`, `users:read`, `admin:access` |

Set `IamConfig.registration.defaultRole = 'MEMBER'` so every public signup becomes a `MEMBER`.

---

## 1. Shared object shapes (reused everywhere)

```jsonc
// Money is always an integer in paise; Plan
{
  "id": "a0000000-0000-4000-8000-000000000001",
  "code": "GOLD",
  "name": "Gold",
  "description": "Full access, free court play",
  "monthlyFeePaise": 300000,
  "courtDiscountPct": 100,
  "shopDiscountPct": 15,
  "barDiscountPct": 10,
  "maxBookingsPerDay": 2,
  "bookingHorizonDays": 14,
  "minAge": null,
  "maxAge": null,
  "isActive": true
}
```

```jsonc
// Member (list item / detail). membership is null when the member has never had one.
{
  "id": "b0000000-0000-4000-8000-000000000001",
  "memberCode": "CC-000123",
  "fullName": "Aarav Mehta",
  "phone": "+919876543210",
  "email": "aarav@example.com",
  "dateOfBirth": "1994-05-17",
  "photoUrl": null,
  "hasLogin": true,
  "membership": {
    "id": "b1000000-0000-4000-8000-000000000001",
    "status": "ACTIVE",               // ACTIVE | EXPIRED | CANCELLED | REPLACED
    "plan": { "id": "a0000000-0000-4000-8000-000000000002", "code": "SILVER", "name": "Silver" },
    "startsOn": "2026-09-20",
    "endsOn": "2026-10-19",
    "daysLeft": 16,
    "expiryState": "OK",              // OK | EXPIRING_SOON (<= 7 days) | EXPIRED
    "cancelAtPeriodEnd": false,
    "pendingPlan": null               // { code, name } when a downgrade is scheduled
  },
  "entitlements": {                   // resolved from the active plan; all zeros for no plan
    "courtDiscountPct": 30,
    "shopDiscountPct": 8,
    "barDiscountPct": 5,
    "maxBookingsPerDay": 2,
    "bookingHorizonDays": 7
  },
  "createdAt": "2026-09-20T09:14:00.000Z"
}
```

```jsonc
// Booking
{
  "id": "c0000000-0000-4000-8000-000000000001",
  "court": { "id": "d0000000-0000-4000-8000-000000000001", "name": "Tennis Court 1", "type": "TENNIS" },
  "kind": "STANDARD",                 // STANDARD | SOCIAL | TRIAL
  "member": { "id": "b0000000-0000-4000-8000-000000000001", "memberCode": "CC-000123", "fullName": "Aarav Mehta" },
  "guest": null,                      // { "name", "phone", "email" } for walk-ins; member is null then
  "startsAt": "2026-10-09T12:30:00.000Z",
  "endsAt": "2026-10-09T13:30:00.000Z",
  "bookingDate": "2026-10-09",
  "status": "CONFIRMED",              // CONFIRMED | COMPLETED | CANCELLED | NO_SHOW
  "cancelledLate": false,
  "channel": "DESK",                  // DESK | PHONE | ONLINE | WEBSITE_TRIAL
  "basePricePaise": 60000,
  "discountPct": 30,
  "pricePaise": 42000,
  "paymentStatus": "UNPAID",          // UNPAID | PAID | WAIVED | REFUNDED
  "socialSessionId": null,
  "createdAt": "2026-10-09T10:00:00.000Z"
}
```

```jsonc
// Product
{
  "id": "e0000000-0000-4000-8000-000000000001",
  "sku": "SHOE-CC-42",
  "name": "CourtPro Tennis Shoes (UK 8)",
  "category": "SHOE",                 // RACKET | BALL | SHOE | ACCESSORY | APPAREL
  "imageUrl": null,
  "pricePaise": 450000,
  "yourPricePaise": 382500,           // price for the caller after plan discount (list price for guests/public)
  "discountPct": 15,
  "stockQty": 1,
  "inStock": true,
  "lowStock": true,                   // staff only fields below
  "reorderLevel": 5,
  "isActive": true
}
```

```jsonc
// Order
{
  "id": "f0000000-0000-4000-8000-000000000001",
  "orderNumber": "ORD-000045",
  "channel": "ONLINE",                // POS | ONLINE
  "fulfilment": "PICKUP",             // COUNTER | PICKUP | DELIVERY
  "status": "PLACED",                 // COMPLETED | PLACED | READY | OUT_FOR_DELIVERY | COLLECTED | DELIVERED | CANCELLED
  "member": { "id": "b0000000-0000-4000-8000-000000000001", "memberCode": "CC-000123", "fullName": "Aarav Mehta" },
  "customerName": null,
  "deliveryAddress": null,
  "items": [
    { "productId": "e0000000-0000-4000-8000-000000000001", "name": "CourtPro Tennis Shoes (UK 8)", "qty": 1, "unitPricePaise": 450000, "discountPct": 15, "lineTotalPaise": 382500 }
  ],
  "subtotalPaise": 450000,
  "discountPaise": 67500,
  "deliveryFeePaise": 0,
  "totalPaise": 382500,
  "paymentStatus": "UNPAID",          // UNPAID | PAID | REFUNDED
  "createdAt": "2026-10-09T10:05:00.000Z"
}
```

```jsonc
// Tab (bar)
{
  "id": "10000000-0000-4000-8000-000000000001",
  "tabNumber": 218,
  "status": "OPEN",                   // OPEN | SETTLED | VOID
  "table": { "id": "11000000-0000-4000-8000-000000000003", "name": "T3" },
  "member": { "id": "b0000000-0000-4000-8000-000000000001", "memberCode": "CC-000123", "fullName": "Aarav Mehta", "barDiscountPct": 5 },
  "guestName": null,
  "openedAt": "2026-10-09T13:40:00.000Z",
  "items": [
    {
      "id": "12000000-0000-4000-8000-000000000001",
      "menuItemId": "13000000-0000-4000-8000-000000000001",
      "name": "Masala Fries",
      "qty": 2,
      "unitPricePaise": 18000,
      "discountPct": 5,
      "lineTotalPaise": 34200,
      "status": "SENT",               // PENDING | SENT | VOID
      "ticketId": "14000000-0000-4000-8000-000000000001",
      "note": "extra spicy"
    }
  ],
  "subtotalPaise": 36000,
  "discountPaise": 1800,
  "totalPaise": 34200,
  "settledAt": null
}
```

```jsonc
// Lead
{
  "id": "15000000-0000-4000-8000-000000000001",
  "name": "Riya Kapoor",
  "phone": "+919811122233",
  "email": "riya@example.com",
  "source": "WEBSITE_ENQUIRY",        // WEBSITE_ENQUIRY | WEBSITE_TRIAL | WALK_IN | PHONE | REFERRAL
  "status": "NEW",                    // NEW | CONTACTED | QUOTED | WON | LOST
  "interestedPlan": { "id": "a0000000-0000-4000-8000-000000000002", "code": "SILVER", "name": "Silver" },
  "message": "Interested in weekday evening padel for two.",
  "assignedTo": { "id": "…", "name": "Front Desk 1" },
  "nextFollowUpAt": "2026-10-10T05:30:00.000Z",
  "memberId": null,
  "createdAt": "2026-10-09T09:00:00.000Z"
}
```

```jsonc
// Invoice
{
  "id": "16000000-0000-4000-8000-000000000001",
  "invoiceNumber": "INV-2026-0042",
  "status": "SENT",                   // DRAFT | SENT | PAID | VOID
  "billTo": { "type": "BUSINESS_CLIENT", "id": "17000000-0000-4000-8000-000000000001", "name": "Acme Corp" },  // type MEMBER | BUSINESS_CLIENT
  "issueDate": "2026-10-01",
  "dueDate": "2026-10-16",
  "lines": [{ "description": "Corporate court block, 10 hours", "qty": 10, "unitPricePaise": 60000, "lineTotalPaise": 600000 }],
  "subtotalPaise": 600000,
  "taxPaise": 91525,                  // portion of the inclusive total
  "totalPaise": 600000,
  "paidPaise": 0,
  "balancePaise": 600000,
  "notes": null
}
```

```jsonc
// Notification
{ "id": "18000000-0000-4000-8000-000000000001", "type": "LOW_STOCK", "title": "Low stock: CourtPro Tennis Shoes (UK 8)", "body": "1 left (reorder at 5)", "link": "/inventory", "readAt": null, "createdAt": "2026-10-09T10:06:00.000Z" }
```

---

## 2. Existing endpoints reused (no change unless stated)

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| POST | `/auth/signup` | PUB | Existing. With `defaultRole = MEMBER` new users become members-to-be. Body `{ email, password, name }` (strict). |
| POST | `/auth/login` | PUB | Existing. Returns `SessionResponse { user, session, effectivePermissions }`. |
| POST | `/auth/logout` | ANY | Existing. |
| GET | `/auth/session` | ANY | Existing. UI uses `effectivePermissions` and `hasPermission()` to build navigation. |
| GET / PUT | `/profile`, POST `/profile/change-password` | ANY (`profile:*:self`) | Existing. |
| `*` | `/iam/*` | OWN, ADMIN | Existing admin screens (users, roles, groups, policies, permissions). |
| GET | `/health`, `/health/ready` | PUB | Existing. |

---

## 3. Public website (`/public/*`, no auth, stricter rate limit, no PII in responses)

Rate limit **30 requests/minute/IP** for GETs, **5/minute/IP** for POSTs (use the existing `@fastify/rate-limit` per-route config).

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/public/club` | PUB | none | `{ name, tagline, phone, address, hours: {open, close}, timezone, courtTypes: [{ id, code, name, baseRatePaise, trialFeePaise, courtCount }], socialPlay: { weekday: 5, startsTime: "18:00", endsTime: "22:00" } }` | none |
| GET | `/public/plans` | PUB | none | `Plan[]` (active only, ordered) | none |
| GET | `/public/availability` | PUB | query `date` (YYYY-MM-DD, required), `courtTypeId` (optional) | **Availability** (section 5.1) with `pricePaise` = walk-in price and no booking details | `400`, `422 BEYOND_BOOKING_HORIZON` (public grid: 7 days, matching the trial horizon; walk-in guests booked by staff: 2 days) |
| GET | `/public/products` | PUB | query `category`, `q`, `page`, `limit` | paginated `Product` with only `id, sku, name, category, imageUrl, pricePaise, inStock` | `400` |
| POST | `/public/enquiries` | PUB | `{ name, phone?, email?, message, interestedPlanId? }` (phone or email required) | `201 { id, message: "Thanks, we'll be in touch within one working day." }` | `400`, `429` |
| POST | `/public/trial-bookings` | PUB | `{ courtId, startsAt, name, phone, email? }` | `201 { booking: Booking, leadId: uuid, message }` | `400`, `409 SLOT_TAKEN`, `409 TRIAL_ALREADY_USED`, `422 INVALID_SLOT_START`, `422 BEYOND_BOOKING_HORIZON`, `429` |
| GET | `/public/reports/shared/:token` | PUB | optional query `range` (defaults to the link's `defaultRange`) | **DashboardReport** (section 11.1, summary only: no `owed`, no `alerts`, no names) plus `expiresAt` | `400`, `404 SHARE_LINK_INVALID` (unknown, revoked or expired), `429` |

Side effects: an enquiry creates a `leads` row (`WEBSITE_ENQUIRY`) and a `NEW_LEAD` notification for every `FRONT_DESK` and `OWNER` user. A trial creates a `STANDARD`-style booking of kind `TRIAL` (price `trialFeePaise`, `paymentStatus: UNPAID`, pay at the club), a lead (`WEBSITE_TRIAL`) and the same notification.

**Example, POST `/public/trial-bookings`**

```json
// request
{ "courtId": "d0000000-0000-4000-8000-000000000003", "startsAt": "2026-10-10T12:30:00.000Z", "name": "Riya Kapoor", "phone": "+919811122233", "email": "riya@example.com" }
```
```json
// 201
{
  "booking": {
    "id": "c0000000-0000-4000-8000-000000000009",
    "court": { "id": "d0000000-0000-4000-8000-000000000003", "name": "Padel Court 1", "type": "PADEL" },
    "kind": "TRIAL", "member": null,
    "guest": { "name": "Riya Kapoor", "phone": "+919811122233", "email": "riya@example.com" },
    "startsAt": "2026-10-10T12:30:00.000Z", "endsAt": "2026-10-10T13:30:00.000Z", "bookingDate": "2026-10-10",
    "status": "CONFIRMED", "cancelledLate": false, "channel": "WEBSITE_TRIAL",
    "basePricePaise": 60000, "discountPct": 0, "pricePaise": 19900, "paymentStatus": "UNPAID",
    "socialSessionId": null, "createdAt": "2026-10-09T09:00:00.000Z"
  },
  "leadId": "15000000-0000-4000-8000-000000000002",
  "message": "Trial booked. Pay at the club on arrival."
}
```
```json
// 409
{ "statusCode": 409, "error": "Conflict", "message": "That slot was just taken. Please pick another time.", "code": "SLOT_TAKEN", "requestId": "req_…" }
```

---

## 4. Plans, members, memberships (Scene 1)

### 4.1 Plans

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/plans` | ANY | none | `Plan[]` | 401 |
| PUT | `/plans/:id` | OWN | `{ name?, monthlyFeePaise?, courtDiscountPct?, shopDiscountPct?, barDiscountPct?, maxBookingsPerDay?, bookingHorizonDays?, isActive? }` (all 0–100 where `Pct`) | `Plan` | 400, 401, 403, 404 |

### 4.2 Members

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/members` | FD, OWN | query `q` (name, phone or code, partial, min 2 chars), `status` (`ACTIVE`/`EXPIRED`/`EXPIRING_SOON`/`NONE`), `planCode`, `page`, `limit`, `sort`, `order` | paginated `Member` | 400, 401, 403 |
| GET | `/members/lookup` | FD, BAR, OWN | query `q` (min 2 chars), `limit` (default 8, max 20) | `{ id, memberCode, fullName, phone, planCode, expiryState, barDiscountPct, shopDiscountPct }[]` | 400, 401, 403 |
| POST | `/members` | FD, OWN | `{ fullName, phone, email?, dateOfBirth?, planId, paymentMethod: "CASH"\|"CARD"\|"UPI", startsOn? }` | `201 { member: Member, invoice: Invoice (status PAID) , payment: { id, amountPaise, method } }` | 400, 401, 403, `422 JUNIOR_AGE_INVALID`, `409` (duplicate phone with an active membership: `code: "MEMBER_HAS_ACTIVE_MEMBERSHIP"`) |
| GET | `/members/:id` | FD, OWN | none | `Member` | 401, 403, 404 |
| PATCH | `/members/:id` | FD, OWN | `{ fullName?, phone?, email?, dateOfBirth?, notes? }` | `Member` | 400, 401, 403, 404 |
| GET | `/members/:id/timeline` | FD, OWN | query `page`, `limit` | paginated `{ type: "CHECKIN"\|"BOOKING"\|"ORDER"\|"TAB"\|"INVOICE"\|"MEMBERSHIP", at, title, detail, amountPaise?, link? }` newest first | 401, 403, 404 |
| POST | `/members/:id/checkin` | FD, OWN | `{ bookingId? }` | `201 { id, checkedInAt, member: Member }` (response includes expiry state so the desk can warn) | 401, 403, 404 |
| POST | `/members/:id/membership/renew` | FD, OWN | `{ paymentMethod }` | `{ member: Member, invoice: Invoice, payment }` | 401, 403, 404 |
| POST | `/members/:id/membership/change-plan` | FD, OWN | `{ planId, paymentMethod? }` | Upgrade: `{ member, topUpInvoice: Invoice \| null, effective: "NOW" }`; Downgrade: `{ member, effective: "AT_RENEWAL", effectiveOn: "2026-10-19" }` | 400, 401, 403, 404, `422 JUNIOR_AGE_INVALID` |
| POST | `/members/:id/membership/cancel` | FD, OWN | `{ reason? }` | `Member` (`cancelAtPeriodEnd: true`) | 401, 403, 404 |
| GET | `/me/member` | MEM | none | `Member`, or `404` with `code: "NOT_A_MEMBER"` if the user has no member profile yet | 401, 404 |
| PUT | `/me/member` | MEM | `{ fullName, phone, dateOfBirth? }` (creates or updates the caller's own profile; a profile without membership books at walk-in price) | `Member` | 400, 401 |

**Example, POST `/members`**

```json
{ "fullName": "Aarav Mehta", "phone": "+919876543210", "email": "aarav@example.com", "dateOfBirth": "1994-05-17", "planId": "a0000000-0000-4000-8000-000000000002", "paymentMethod": "UPI" }
```
```json
{
  "member": { "id": "b0000000-0000-4000-8000-000000000001", "memberCode": "CC-000123", "fullName": "Aarav Mehta", "phone": "+919876543210", "email": "aarav@example.com", "dateOfBirth": "1994-05-17", "photoUrl": null, "hasLogin": false,
    "membership": { "id": "b1000000-0000-4000-8000-000000000001", "status": "ACTIVE", "plan": { "id": "a0000000-0000-4000-8000-000000000002", "code": "SILVER", "name": "Silver" }, "startsOn": "2026-10-09", "endsOn": "2026-11-07", "daysLeft": 29, "expiryState": "OK", "cancelAtPeriodEnd": false, "pendingPlan": null },
    "entitlements": { "courtDiscountPct": 30, "shopDiscountPct": 8, "barDiscountPct": 5, "maxBookingsPerDay": 2, "bookingHorizonDays": 7 },
    "createdAt": "2026-10-09T09:14:00.000Z" },
  "invoice": { "id": "16000000-0000-4000-8000-000000000010", "invoiceNumber": "INV-2026-0043", "status": "PAID", "billTo": { "type": "MEMBER", "id": "b0000000-0000-4000-8000-000000000001", "name": "Aarav Mehta" }, "issueDate": "2026-10-09", "dueDate": "2026-10-09", "lines": [{ "description": "Silver membership, 30 days", "qty": 1, "unitPricePaise": 150000, "lineTotalPaise": 150000 }], "subtotalPaise": 150000, "taxPaise": 22881, "totalPaise": 150000, "paidPaise": 150000, "balancePaise": 0, "notes": null },
  "payment": { "id": "19000000-0000-4000-8000-000000000001", "amountPaise": 150000, "method": "UPI" }
}
```

---

## 5. Courts and bookings (Scene 2)

### 5.1 Availability (the heart of the UI)

`GET /courts/availability?date=2026-10-09&courtTypeId=…&memberId=…` · Roles: **MEM, FD, OWN** (members always get **their own** price; FD/OWN may pass `memberId` to price for a specific member, otherwise walk-in price). Public equivalent: `/public/availability`.

Staff additionally see who holds a slot (`holder`, `bookingId`); members and public do not.

```json
{
  "date": "2026-10-09",
  "timezone": "Asia/Kolkata",
  "generatedAt": "2026-10-09T10:00:00.000Z",
  "priceFor": { "type": "MEMBER", "label": "Silver", "memberId": "b0000000-0000-4000-8000-000000000001" },
  "courts": [
    {
      "courtId": "d0000000-0000-4000-8000-000000000001",
      "name": "Tennis Court 1",
      "type": "TENNIS",
      "mode": "STANDARD",
      "slots": [
        { "startsAt": "2026-10-09T12:00:00.000Z", "endsAt": "2026-10-09T13:00:00.000Z", "status": "BOOKED", "pricePaise": 42000, "bookingId": "c0000000-0000-4000-8000-000000000020", "holder": "Aarav Mehta" },
        { "startsAt": "2026-10-09T12:30:00.000Z", "endsAt": "2026-10-09T13:30:00.000Z", "status": "BOOKED", "pricePaise": 42000, "bookingId": "c0000000-0000-4000-8000-000000000020", "holder": "Aarav Mehta" },
        { "startsAt": "2026-10-09T13:00:00.000Z", "endsAt": "2026-10-09T14:00:00.000Z", "status": "FREE", "pricePaise": 42000 },
        { "startsAt": "2026-10-09T13:30:00.000Z", "endsAt": "2026-10-09T14:30:00.000Z", "status": "BLOCKED", "pricePaise": 42000, "reason": "Resurfacing" }
      ]
    },
    {
      "courtId": "d0000000-0000-4000-8000-000000000003",
      "name": "Padel Court 1",
      "type": "PADEL",
      "mode": "SOCIAL",
      "slots": [
        { "startsAt": "2026-10-09T12:30:00.000Z", "endsAt": "2026-10-09T13:30:00.000Z", "status": "SOCIAL_OPEN", "pricePaise": 14000, "capacity": 4, "spotsLeft": 1, "socialSessionId": "1a000000-0000-4000-8000-000000000001" },
        { "startsAt": "2026-10-09T13:30:00.000Z", "endsAt": "2026-10-09T14:30:00.000Z", "status": "SOCIAL_FULL", "pricePaise": 14000, "capacity": 4, "spotsLeft": 0 }
      ]
    }
  ]
}
```

- A **slot** exists for every half-hour start the court is open (so consecutive slots overlap in time; the UI greys out overlapping ones once one is chosen). In `SOCIAL` mode only on-the-hour slots are returned.
- `status`: `FREE` · `BOOKED` · `BLOCKED` · `SOCIAL_OPEN` · `SOCIAL_FULL` · `PAST`.
- `mode`: `STANDARD` · `SOCIAL` (whole court is in a social window).
- For a member whose daily limit is already used, every `FREE` slot keeps `FREE` but the response sets top-level `"limits": { "usedToday": 2, "maxPerDay": 2 }` (present for MEM, and for FD when `memberId` is passed) so the UI can disable booking and explain.
- Errors: `400`, `401` (non-public), `422 BEYOND_BOOKING_HORIZON`.

### 5.2 Bookings

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/courts` | ANY | none | `{ id, name, type, typeName, baseRatePaise, socialCapacity, isActive }[]` | 401 |
| POST | `/bookings` | MEM (self), FD, OWN | `{ courtId, startsAt, memberId?, guest?: { name, phone, email? }, channel?: "DESK"\|"PHONE"\|"ONLINE", payNow?: { method } }`. MEM: `memberId`/`guest` ignored/forbidden (403 if another member's id is sent). FD/OWN: exactly one of `memberId` or `guest`. | `201 Booking` (when `payNow` given: `paymentStatus: "PAID"` and a payment row is written) | 400, 401, 403, `409 SLOT_TAKEN`, `409 MEMBER_DOUBLE_BOOKED`, `409 SOCIAL_WINDOW`, `422 INVALID_SLOT_START`, `422 DAILY_LIMIT_REACHED`, `422 BEYOND_BOOKING_HORIZON`, `422 MEMBERSHIP_EXPIRES_BEFORE_SLOT` |
| POST | `/bookings/social/join` | MEM (self), FD, OWN | `{ courtId, startsAt, memberId?, guest? }` (same rules as above) | `201 Booking` with `kind: "SOCIAL"`, `socialSessionId`, and `socialSession: { capacity, joined }` | 400, 401, 403, `409 SOCIAL_FULL`, `409 SOCIAL_WINDOW`, `409 MEMBER_DOUBLE_BOOKED`, `422 NOT_A_SOCIAL_SLOT`, `422 DAILY_LIMIT_REACHED` |
| GET | `/bookings` | FD, OWN | query `date` or `from`+`to`, `courtId`, `memberId`, `status`, `kind`, `page`, `limit` | paginated `Booking` | 400, 401, 403 |
| GET | `/me/bookings` | MEM | query `scope` = `upcoming` (default) or `past`, `page`, `limit` | paginated `Booking` (own only) | 401 |
| GET | `/bookings/:id` | FD, OWN, MEM (own) | none | `Booking` | 401, 403, 404 |
| POST | `/bookings/:id/cancel` | FD, OWN, MEM (own) | `{ reason?: string, override?: boolean }`. `override` (FD/OWN only) waives the cutoff and requires `reason`. | `{ booking: Booking, refund: { amountPaise, method } \| null, quotaFreed: boolean, late: boolean }` | 401, 403, 404, `409 CANCEL_NOT_ALLOWED`, 400 |
| POST | `/bookings/:id/pay` | FD, OWN; MEM (own, `method: "UPI"` only) | `{ method: "CASH"\|"CARD"\|"UPI", reference? }` | `{ booking: Booking, payment: { id, amountPaise, method, paidAt } }` | 400, 401, 403, 404, 409 (already paid or waived) |
| POST | `/bookings/:id/no-show` | FD, OWN | none | `Booking` (`status: "NO_SHOW"`) | 401, 403, 404, 409 |
| POST | `/bookings/:id/complete` | FD, OWN | none | `Booking` (`status: "COMPLETED"`) | 401, 403, 404, 409 |

**Example, POST `/bookings` (member, Silver)**

```json
{ "courtId": "d0000000-0000-4000-8000-000000000001", "startsAt": "2026-10-09T12:30:00.000Z" }
```
```json
{
  "id": "c0000000-0000-4000-8000-000000000020",
  "court": { "id": "d0000000-0000-4000-8000-000000000001", "name": "Tennis Court 1", "type": "TENNIS" },
  "kind": "STANDARD",
  "member": { "id": "b0000000-0000-4000-8000-000000000001", "memberCode": "CC-000123", "fullName": "Aarav Mehta" },
  "guest": null,
  "startsAt": "2026-10-09T12:30:00.000Z", "endsAt": "2026-10-09T13:30:00.000Z", "bookingDate": "2026-10-09",
  "status": "CONFIRMED", "cancelledLate": false, "channel": "ONLINE",
  "basePricePaise": 60000, "discountPct": 30, "pricePaise": 42000,
  "paymentStatus": "UNPAID", "socialSessionId": null, "createdAt": "2026-10-09T10:00:00.000Z"
}
```

**Example errors (all use the standard body)**

```json
{ "statusCode": 422, "error": "Unprocessable Entity", "message": "You already have 2 bookings on this day.", "code": "DAILY_LIMIT_REACHED", "requestId": "req_…" }
```
```json
{ "statusCode": 409, "error": "Conflict", "message": "This court-hour is a Friday social session. Join it instead.", "code": "SOCIAL_WINDOW", "requestId": "req_…" }
```

### 5.3 Maintenance blocks, social windows, demo tool

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/courts/blocks` | OWN | `{ courtId, startsAt, endsAt, reason }` (30-minute aligned, `endsAt > startsAt`) | `201 { id, courtId, startsAt, endsAt, reason }` | 400, 401, 403, `409 SLOT_TAKEN` (`details` lists conflicting bookings) |
| DELETE | `/courts/blocks/:id` | OWN | none | `{ success: true, message }` | 401, 403, 404 |
| GET | `/social-windows` | ANY | none | `{ id, weekday, startsTime, endsTime, isActive }[]` | 401 |
| PUT | `/social-windows/:id` | OWN | `{ weekday?, startsTime?, endsTime?, isActive? }` (`weekday` 0 = Sunday ... 6 = Saturday; a one-sided time edit is checked against the stored time) | the window | 400, 401, 403, 404, `422 VALIDATION_ERROR` (end not after start) |
| POST | `/demo/booking-race` **(ADDITION, disabled when `NODE_ENV=production`)** | OWN, ADMIN | `{ courtId, startsAt, attempts: 20 }` (max 50) | `{ attempts: 20, confirmed: 1, slotTaken: 19, other: 0, durationMs: 143, bookingId: "…" }` (the endpoint creates one throwaway test member per attempt and deletes everything afterwards) | 400, 401, 403, `404` in production |

---

## 6. Shop and inventory (Scene 3)

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/products` | MEM, FD, OWN | query `category`, `q`, `lowStock=true`, `inStock=true`, `page`, `limit` | paginated `Product` (`yourPricePaise` uses the caller's plan; staff-only fields only for FD/OWN) | 400, 401 |
| GET | `/products/:id` | MEM, FD, OWN | none | `Product` | 401, 404 |
| POST | `/products` | OWN | `{ sku, name, category, pricePaise, stockQty, reorderLevel?, imageUrl?, description?, discountable? }` | `201 Product` | 400, 401, 403, 409 (duplicate sku) |
| PUT | `/products/:id` | OWN | any subset of the create fields except `stockQty` (stock changes go through restock or adjust) | `Product` | 400, 401, 403, 404 |
| POST | `/products/:id/restock` | FD, OWN | `{ qty (>0), note? }` | `{ product: Product, movement: { id, qtyDelta, balanceAfter, reason: "RESTOCK" } }` | 400, 401, 403, 404 |
| POST | `/products/:id/adjust` | OWN | `{ qtyDelta (non-zero), note (required) }` | same shape as restock with `reason: "ADJUSTMENT"` | 400, 401, 403, 404, 409 (would go below 0) |
| GET | `/products/:id/movements` | FD, OWN | query `page`, `limit` | paginated `{ id, qtyDelta, balanceAfter, reason, orderNumber?, note?, createdAt }` | 401, 403, 404 |
| GET | `/inventory/low-stock` | FD, OWN | none | `{ product: Product, shortBy: number }[]` ordered by urgency | 401, 403 |
| POST | `/orders/quote` | MEM, FD, OWN | `{ memberId? (FD/OWN), items: [{ productId, qty }], fulfilment?: "PICKUP"\|"DELIVERY" }` | `{ items: [{ productId, name, qty, unitPricePaise, discountPct, lineTotalPaise, inStock }], subtotalPaise, discountPaise, deliveryFeePaise, totalPaise, discountPct }` (does not touch stock) | 400, 401, 404 |
| POST | `/orders/pos` | FD, OWN | `{ memberId?, customerName?, items: [{ productId, qty }], paymentMethod: "CASH"\|"CARD"\|"UPI" }` | `201 Order` (`channel: "POS"`, `status: "COMPLETED"`, `paymentStatus: "PAID"`; payment row written; stock decremented) | 400, 401, 403, `409 OUT_OF_STOCK` |
| POST | `/orders/online` | MEM | `{ items: [{ productId, qty }], fulfilment: "PICKUP"\|"DELIVERY", deliveryAddress? (required for DELIVERY), payNow?: { method: "UPI" } }` | `201 Order` (`channel: "ONLINE"`, `status: "PLACED"`, stock reserved) | 400, 401, 403, `409 OUT_OF_STOCK` |
| GET | `/orders` | FD, OWN | query `status`, `channel`, `fulfilment`, `from`, `to`, `page`, `limit` | paginated `Order` | 400, 401, 403 |
| GET | `/me/orders` | MEM | query `page`, `limit` | paginated `Order` (own) | 401 |
| GET | `/orders/:id` | FD, OWN, MEM (own) | none | `Order` | 401, 403, 404 |
| PATCH | `/orders/:id/status` | FD, OWN | `{ status }` where allowed transitions are `PLACED→READY`, `READY→COLLECTED` (pickup), `PLACED→OUT_FOR_DELIVERY`, `OUT_FOR_DELIVERY→DELIVERED` | `Order` | 400, 401, 403, 404, `409 ORDER_STATE_INVALID` |
| POST | `/orders/:id/pay` | FD, OWN; MEM (own, UPI) | `{ method, reference? }` | `{ order: Order, payment }` | 400, 401, 403, 404, 409 |
| POST | `/orders/:id/cancel` | FD, OWN, MEM (own, only while `PLACED`) | `{ reason? }` | `{ order: Order, stockReturned: [{ productId, qty }], refund: { amountPaise, method } \| null }` | 401, 403, 404, `409 ORDER_STATE_INVALID` |

**Example, POST `/orders/pos` out-of-stock**

```json
{ "statusCode": 409, "error": "Conflict", "message": "Not enough stock for CourtPro Tennis Shoes (UK 8): 0 left.", "code": "OUT_OF_STOCK",
  "details": [{ "field": "items[0].productId", "message": "requested 1, available 0", "code": "OUT_OF_STOCK" }], "requestId": "req_…" }
```

Side effects of any successful sale: a `stock_movements` row per line; when the new stock is at or below `reorderLevel` and no alert is outstanding, a `LOW_STOCK` notification for every `FRONT_DESK` and `OWNER` user (dedupe key `low-stock:<productId>:<yyyy-mm-dd>`); online orders also notify `ONLINE_ORDER` to the desk.

---

## 7. Bar POS (Scene 4)

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/bar/tables` | BAR, FD, OWN | none | `{ id, name, seats, status: "FREE"\|"OCCUPIED", openTab: { id, tabNumber, label, totalPaise, openedAt } \| null }[]` | 401, 403 |
| GET | `/bar/menu` | BAR, FD, OWN | query `category` | `{ id, name, category, station, pricePaise, discountable, isAvailable }[]` | 401, 403 |
| POST | `/bar/menu` | OWN | `{ name, category, station, pricePaise, discountable? }` | `201` menu item | 400, 401, 403 |
| PUT | `/bar/menu/:id` | OWN | any subset, plus `isAvailable` | menu item | 400, 401, 403, 404 |
| POST | `/bar/tabs` | BAR, OWN | `{ tableId?, memberId?, guestName? }` (one of `memberId` or `guestName` required) | `201 Tab` | 400, 401, 403, `409 TABLE_OCCUPIED` |
| GET | `/bar/tabs` | BAR, OWN | query `status` (default `OPEN`), `date`, `page`, `limit` | paginated `Tab` (without items; `itemCount`) | 401, 403 |
| GET | `/bar/tabs/:id` | BAR, OWN | none | `Tab` | 401, 403, 404 |
| POST | `/bar/tabs/:id/items` | BAR, OWN | `{ menuItemId, qty (1–20), note? }` | `Tab` (discount applied automatically for members) | 400, 401, 403, 404, 409 (tab not open, or item unavailable) |
| PATCH | `/bar/tabs/:id/items/:itemId` | BAR, OWN | `{ qty (1–20) }` (only `PENDING` lines; the price and discount snapshotted when the line was added are kept) | `Tab` | 400, 401, 403, 404, `409 ITEM_ALREADY_SENT`, `409 ITEM_ALREADY_VOID`, 409 (tab not open) |
| DELETE | `/bar/tabs/:id/items/:itemId` | BAR (while `PENDING`), OWN (any status) | none | `Tab` | 401, 403, 404, 409 |
| POST | `/bar/tabs/:id/send` | BAR, OWN | none | `{ tab: Tab, tickets: [{ id, station, status: "NEW", itemCount }] }` (all `PENDING` items become `SENT` and grouped into one ticket per station) | 401, 403, 404, `422 TAB_EMPTY` |
| POST | `/bar/tabs/:id/settle` | BAR, OWN | `{ payments: [{ method: "CASH"\|"CARD"\|"UPI", amountPaise?, reference? }] }`. One entry settles the full total; several entries must sum exactly to `totalPaise` (split payment is NICE, accepted by the same shape). | `{ tab: Tab (status SETTLED), payments: [{ id, method, amountPaise }], receipt: { tabNumber, totalPaise, discountPaise, paidAt } }` | 400, 401, 403, 404, `409 ALREADY_SETTLED`, `422 TAB_EMPTY` |
| POST | `/bar/tabs/:id/void` | OWN | `{ reason }` | `Tab` (status VOID) | 400, 401, 403, 404, 409 |
| GET | `/bar/tickets` | BAR, OWN | query `status` (comma list, default `NEW,PREPARING,READY`), `station` | `{ id, ticketNumber, tab: { id, tabNumber, label }, table: { name } \| null, station, status, createdAt, minutesWaiting, items: [{ name, qty, note }] }[]` oldest first | 401, 403 |
| PATCH | `/bar/tickets/:id/status` | BAR, OWN | `{ status }`: `NEW→PREPARING→READY→SERVED` (or `CANCELLED`) | the ticket | 400, 401, 403, 404, `409 ORDER_STATE_INVALID` |
| GET | `/bar/earnings` | BAR (own shift day), OWN | query `date` (default today) | `{ date, totalPaise, tabsSettled, averageTabPaise, byMethod: [{ method, amountPaise }], byShift: [{ shiftId, employeeName, startsAt, endsAt, amountPaise }], topItems: [{ name, qty, amountPaise }] }` | 400, 401, 403 |

**Implementation notes (M-12, these are the rules the code enforces):**

- `category` is `DRINK \| FOOD \| SNACK` and `station` is `BAR \| KITCHEN`; anything else is `400`.
- **FRONT_DESK cannot call `/bar/*`.** The role holds no `bar:read`, so the "FD" entries for tables and menu above are not granted; widening FD would also expose tabs and earnings.
- Owner-only (`bar:manage` and `reports:read`): `POST/PUT /bar/menu`, `POST /bar/tabs/:id/void` (the reason is written to the audit log as `BAR_TAB_VOIDED`).
- Bar staff may remove only `PENDING` items; removing a `SENT` item by bar staff is `403 FORBIDDEN`. Removed items become `status: "VOID"` and drop out of the totals.
- Each item snapshots its price and the member's bar discount when added. A member whose membership has lapsed pays the undiscounted price. Items marked `discountable: false` are never discounted.
- Cancelling a ticket (`CANCELLED`) voids its `SENT` items on an `OPEN` tab so cancelled food is not billed; a settled bill is never changed. Voiding a tab cancels its unfinished tickets.
- `ticketNumber` is a database identity column (migration `0005`).
- `GET /bar/earnings`: bar staff may only request today's club date (`403` otherwise); the owner may request any date. A day is the club-timezone day, so a payment at 23:30 IST belongs to that day, not the UTC day. `byShift` lists only payments that carry a shift.
- Settling a tab with `total = 0` (every line discounted 100%) writes no payment rows.

**Example, POST `/bar/tabs/:id/settle` (UPI)**

```json
{ "payments": [{ "method": "UPI", "reference": "UPI-8837461" }] }
```
```json
{
  "tab": { "id": "10000000-0000-4000-8000-000000000001", "tabNumber": 218, "status": "SETTLED", "table": { "id": "11000000-0000-4000-8000-000000000003", "name": "T3" }, "member": { "id": "b0000000-0000-4000-8000-000000000001", "memberCode": "CC-000123", "fullName": "Aarav Mehta", "barDiscountPct": 5 }, "guestName": null, "openedAt": "2026-10-09T13:40:00.000Z", "items": [], "subtotalPaise": 36000, "discountPaise": 1800, "totalPaise": 34200, "settledAt": "2026-10-09T14:20:00.000Z" },
  "payments": [{ "id": "19000000-0000-4000-8000-000000000020", "method": "UPI", "amountPaise": 34200 }],
  "receipt": { "tabNumber": 218, "totalPaise": 34200, "discountPaise": 1800, "paidAt": "2026-10-09T14:20:00.000Z" }
}
```
(`items` shortened here for readability; the real response lists them.)

---

## 8. Staff shifts

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/shifts` | FD, BAR, OWN | query `from`, `to` (dates), `employeeId` (staff can only see their own unless OWN/FD roster view) | `{ id, employee: { id, fullName }, roleLabel, startsAt, endsAt, clockInAt, clockOutAt, status: "SCHEDULED"\|"ON_SHIFT"\|"DONE"\|"MISSED" }[]` | 400, 401, 403 |
| POST | `/shifts` | OWN | `{ employeeId, roleLabel, startsAt, endsAt }` | `201` shift | 400, 401, 403, `409` (overlap) |
| DELETE | `/shifts/:id` | OWN | none | `{ success, message }` | 401, 403, 404 |
| POST | `/shifts/:id/clock-in` | FD, BAR (own shift) | none | shift (with `clockInAt`) | 401, 403, 404, 409 |
| POST | `/shifts/:id/clock-out` | FD, BAR (own shift) | none | shift (with `clockOutAt`) | 401, 403, 404, 409 |
| GET | `/me/shift/current` | FD, BAR | none | shift or `null` | 401 |

Payments recorded by a user with an open shift get that `shiftId` automatically.

---

## 9. CRM (Scene 5)

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/crm/leads` | FD, OWN | query `status`, `source`, `assignedTo`, `dueToday=true`, `q`, `page`, `limit` | paginated `Lead` plus `quoteCount` | 400, 401, 403 |
| GET | `/crm/summary` | FD, OWN | none | `{ byStatus: { NEW, CONTACTED, QUOTED, WON, LOST }, dueToday, overdue, conversionRatePct }` | 401, 403 |
| POST | `/crm/leads` | FD, OWN | `{ name, phone?, email?, source: "WALK_IN"\|"PHONE"\|"REFERRAL", interestedPlanId?, message? }` | `201 Lead` | 400, 401, 403 |
| GET | `/crm/leads/:id` | FD, OWN | none | `{ lead: Lead, activities: [{ id, type, body, actor, createdAt }], quotes: Quote[] }` | 401, 403, 404 |
| PATCH | `/crm/leads/:id` | FD, OWN | `{ status?, assignedTo?, nextFollowUpAt?, lostReason? }` (`LOST` requires `lostReason`; `WON` only through convert) | `Lead` (a `STATUS_CHANGE` activity is written) | 400, 401, 403, 404 |
| POST | `/crm/leads/:id/activities` | FD, OWN | `{ type: "NOTE"\|"CALL"\|"EMAIL", body }` | `201` activity | 400, 401, 403, 404 |
| POST | `/crm/leads/:id/quotes` | FD, OWN | `{ planId, amountPaise? (defaults to the plan fee), validUntil? (defaults to +14 days), notes? }` | `201 Quote` | 400, 401, 403, 404 |
| POST | `/crm/quotes/:id/send` | FD, OWN | none | `Quote` (`status: "SENT"`, lead becomes `QUOTED`; email sent if enabled, else logged) | 401, 403, 404, 409 |
| PATCH | `/crm/quotes/:id` | FD, OWN | `{ status: "ACCEPTED"\|"REJECTED" }` | `Quote` | 400, 401, 403, 404 |
| POST | `/crm/leads/:id/convert` | FD, OWN | `{ planId, quoteId?, startsOn?, paymentMethod, dateOfBirth?, phone? (required if the lead has none) }` | `201 { lead: Lead (status WON), member: Member, invoice: Invoice (PAID), payment }` created in one transaction | 400, 401, 403, 404, `409 ALREADY_CONVERTED`, `422 JUNIOR_AGE_INVALID` |

`Quote` shape: `{ id, leadId, plan: { id, code, name }, amountPaise, validUntil: "2026-10-23", status: "DRAFT"|"SENT"|"ACCEPTED"|"REJECTED"|"EXPIRED", notes, createdAt }`.

Side effects: new leads (from the public endpoints or manual) always create `NEW_LEAD` notifications for FD and OWN users. A lead that converts logs a `CONVERTED` activity.

---

## 10. Finance and HR (Scene 6)

### 10.1 Invoices and clients

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/invoices` | FD, OWN | query `status`, `memberId`, `businessClientId`, `from`, `to`, `overdue=true`, `page`, `limit` | paginated `Invoice` | 400, 401, 403 |
| POST | `/invoices` | FD, OWN | `{ memberId? \| businessClientId? (exactly one), issueDate?, dueDate? (default +15 days), lines: [{ description, qty, unitPricePaise }] (1–50), notes? }` | `201 Invoice` (`status: "DRAFT"`) | 400, 401, 403, 404 |
| GET | `/invoices/:id` | FD, OWN, MEM (own) | none | `Invoice` plus `payments: [{ id, amountPaise, method, paidAt }]` | 401, 403, 404 |
| POST | `/invoices/:id/send` | FD, OWN | none | `Invoice` (`SENT`) | 401, 403, 404, 409 |
| POST | `/invoices/:id/pay` | FD, OWN | `{ method, amountPaise? (default balance), reference? }` | `{ invoice: Invoice, payment }` (becomes `PAID` when balance reaches 0) | 400, 401, 403, 404, 409 |
| POST | `/invoices/:id/void` | OWN | `{ reason }` | `Invoice` (`VOID`; allowed only if unpaid) | 400, 401, 403, 404, 409 |
| GET | `/business-clients` | FD, OWN | query `q`, `page`, `limit` | paginated `{ id, companyName, contactName, email, phone, gstin, billingAddress, openBalancePaise }` | 401, 403 |
| POST | `/business-clients` | FD, OWN | `{ companyName, contactName?, email?, phone?, gstin?, billingAddress? }` | `201` client | 400, 401, 403 |
| PUT | `/business-clients/:id` | FD, OWN | same fields, all optional | client | 400, 401, 403, 404 |

### 10.2 Payments ledger and tax

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/payments` | OWN | query `from`, `to`, `source`, `method`, `kind`, `page`, `limit` | paginated `{ id, source, sourceId, kind, amountPaise, method, receivedBy: { id, name } \| null, shiftId, paidAt, reference }` | 400, 401, 403 |
| GET | `/finance/tax-summary` | OWN | query `from`, `to` (required) | `{ from, to, rows: [{ source, grossPaise, taxRateBp, taxPaise, netPaise }], totals: { grossPaise, taxPaise, netPaise }, note: "Simplified: inclusive rates per source" }` | 400, 401, 403 |

`GET /finance/tax-summary` example response:

```json
{
  "from": "2026-10-01", "to": "2026-10-31",
  "rows": [
    { "source": "COURT", "grossPaise": 8120000, "taxRateBp": 1800, "taxPaise": 1238644, "netPaise": 6881356 },
    { "source": "BAR", "grossPaise": 4410000, "taxRateBp": 500, "taxPaise": 210000, "netPaise": 4200000 }
  ],
  "totals": { "grossPaise": 12530000, "taxPaise": 1448644, "netPaise": 11081356 },
  "note": "Simplified: inclusive rates per source"
}
```

### 10.3 Employees, leave, payroll

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/hr/employees` | OWN | query `department`, `status`, `q` | `{ id, fullName, position, department, monthlySalaryPaise, hiredOn, status, leaveDaysThisYear }[]` | 401, 403 |
| POST | `/hr/employees` | OWN | `{ fullName, email?, phone?, position, department, monthlySalaryPaise, hiredOn, userId? }` | `201` employee | 400, 401, 403 |
| PUT | `/hr/employees/:id` | OWN | any subset, plus `status` | employee | 400, 401, 403, 404 |
| GET | `/hr/leave` | OWN | query `status`, `employeeId`, `from`, `to`, `page`, `limit` | paginated `LeaveRequest` | 401, 403 |
| POST | `/hr/leave/:id/decision` | OWN | `{ decision: "APPROVED"\|"REJECTED", note? }` | `LeaveRequest` | 400, 401, 403, 404, `409 LEAVE_OVERLAP`, 409 (already decided) |
| GET | `/me/leave` | FD, BAR, OWN | query `page`, `limit` | paginated `LeaveRequest` (own) | 401 |
| POST | `/me/leave` | FD, BAR, OWN | `{ leaveType: "CASUAL"\|"SICK"\|"PAID", fromDate, toDate, reason? }` | `201 LeaveRequest` (owners notified `LEAVE_REQUEST`) | 400, 401, 403, `409 LEAVE_OVERLAP` |
| GET | `/hr/payroll-summary` | OWN | query `month` (`YYYY-MM`) | `{ month, totalPaise, headcount, byDepartment: [{ department, headcount, amountPaise }], onLeave: [{ employeeName, fromDate, toDate }] }` | 400, 401, 403 |

`LeaveRequest` shape: `{ id, employee: { id, fullName }, leaveType, fromDate, toDate, days, reason, status: "PENDING"|"APPROVED"|"REJECTED"|"CANCELLED", decidedBy: { id, name } | null, decidedAt, decisionNote, createdAt }`.

---

## 11. Owner dashboard and reports (Scene 6)

### 11.1 Dashboard

`GET /reports/dashboard?range=today|week|month` (or `from` and `to` as dates) · **OWN** (also public through a share token, with `kpis`, `bySource`, `byMethod`, `trend` only).

```json
{
  "range": "today",
  "from": "2026-10-09",
  "to": "2026-10-09",
  "generatedAt": "2026-10-09T14:21:00.000Z",
  "kpis": {
    "revenuePaise": 48750000,
    "previousRevenuePaise": 41200000,
    "changePct": 18,
    "bookingsCount": 37,
    "utilisationPct": 64,
    "newMembers": 3,
    "shopOrdersCount": 9,
    "barTabsCount": 21
  },
  "bySource": [
    { "source": "COURT", "amountPaise": 18200000 },
    { "source": "SHOP", "amountPaise": 9300000 },
    { "source": "BAR", "amountPaise": 16100000 },
    { "source": "MEMBERSHIP", "amountPaise": 5150000 },
    { "source": "INVOICE", "amountPaise": 0 }
  ],
  "byMethod": [
    { "method": "CASH", "amountPaise": 12100000 },
    { "method": "CARD", "amountPaise": 15400000 },
    { "method": "UPI", "amountPaise": 21250000 }
  ],
  "trend": [
    { "bucket": "2026-10-09T10:00", "totalPaise": 2100000, "bySource": { "COURT": 1200000, "SHOP": 400000, "BAR": 500000, "MEMBERSHIP": 0, "INVOICE": 0 } }
  ],
  "owed": { "taxPayablePaise": 6120000, "payrollDuePaise": 54000000, "unpaidInvoicesPaise": 1800000, "overdueInvoicesCount": 1 },
  "alerts": { "lowStockCount": 3, "expiringMembershipsCount": 5, "newLeadsCount": 2, "pendingLeaveCount": 1 }
}
```

- `trend.bucket` is hourly (`YYYY-MM-DDTHH:00`) for `today`, daily (`YYYY-MM-DD`) for `week` and `month`.
- Amounts are **net of refunds**. `utilisationPct` = booked court-hours ÷ open court-hours for the period (to date).
- Errors: `400` (bad range), `401`, `403`.

### 11.2 Export and sharing

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/reports/export.csv` | OWN | query `range` or `from`+`to`, `type` = `summary` (default) or `payments` | `text/csv` attachment (`Content-Disposition: attachment; filename="courtos-month-2026-10.csv"`) | 400, 401, 403 |
| POST | `/reports/shares` | OWN | `{ defaultRange?: "today"\|"week"\|"month", expiresInDays?: 1-30 (default 7) }` | `201 { id, url: "http://localhost:3000/share/<token>", token, defaultRange, expiresAt }` (the token is shown **once**; only its hash is stored) | 400, 401, 403 |
| GET | `/reports/shares` | OWN | none | `{ id, defaultRange, expiresAt, revokedAt, createdAt }[]` (never the token) | 401, 403 |
| DELETE | `/reports/shares/:id` | OWN | none | `{ success: true, message }` (sets `revokedAt`) | 401, 403, 404 |

---

## 12. Notifications and jobs

| Method | Path | Roles | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/notifications` | ANY (`notifications:read:self`) | query `unread=true`, `page`, `limit` | paginated `Notification` | 401, 403 |
| GET | `/notifications/unread-count` | ANY | none | `{ count: 3 }` (the topbar bell polls this every 10 seconds) | 401 |
| POST | `/notifications/:id/read` | ANY (`:self`) | none | `Notification` | 401, 403, 404 |
| POST | `/notifications/read-all` | ANY | none | `{ updated: 3 }` | 401 |
| POST | `/admin/jobs/membership-expiry` | OWN, ADMIN | `{ asOf?: "YYYY-MM-DD" }` (`asOf` lets the demo jump forward) | `{ asOf, expired: 2, remindersCreated: 5 }` | 400, 401, 403 |
| POST | `/admin/jobs/release-unpaid-orders` | OWN, ADMIN | none | `{ released: 1, stockReturned: 2 }` | 401, 403 |

The membership-expiry and unpaid-order jobs also run automatically every 15 minutes from `apps/api/src/server.ts` (a plain `setInterval` in a `JobService`, no new dependency) and the manual endpoints exist so the demo does not wait.

---

## 13. Per-route test checklist (AGENTS.md rule T4)

Every route above ships with an `app.inject()` test covering: **400** (invalid body or query), **401** (no cookie), **403** (wrong role, and for `:self` routes another member's resource), and the **success shape**. Plus these adversarial tests (rule T3), non-negotiable:

- A member cannot book, cancel or read another member's booking or order (`403`).
- A member cannot pass `memberId` to get another plan's price.
- A suspended member is denied everywhere.
- A bar user cannot call `/reports/*`, `/payments`, `/hr/*`.
- A share token cannot be reused after `DELETE /reports/shares/:id` or after `expiresAt`.
- 20 concurrent `POST /bookings` for one slot yield exactly one `201`.
- Two concurrent `POST /orders/pos` for the last unit yield exactly one `201` and one `409 OUT_OF_STOCK`.
- A tab cannot be settled twice (`409 ALREADY_SETTLED`).
- A lead cannot be converted twice (`409 ALREADY_CONVERTED`).
