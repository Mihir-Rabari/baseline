# PROJECT_OVERVIEW.md

> **CourtOS**: one connected platform for The Champions Club.
> Source of truth: `Sports_Club_Management_System.pdf` (the "PDF").
> Traceability tags: **[C]** = PDF section 1 (Challenge), **[M]** = section 2 (Meet the club), **[S1]–[S6]** = the six scenes in section 3, in order:
> S1 A new member walks in · S2 Booking a court on a busy evening · S3 Gearing up before a match · S4 After the match, at the bar · S5 A stranger finds the club online · S6 The owner, at the end of the month.
> Anything not in the PDF is marked **(ADDITION)**.

---

## 1. Vision, problem, goals

**Vision.** Replace WhatsApp, Excel and paper at The Champions Club with one system where a court booking, a shoe sale, a bar tab and a website enquiry all land in the same database, so the owner sees the real numbers live. [C][M]

**Problem (from the PDF, "How Things Run Today").**

| Today | Pain | CourtOS answer |
| --- | --- | --- |
| Court bookings over WhatsApp | Double bookings, no limits, no pricing rules | Booking engine with a database-level no-overlap guarantee |
| Member lists in Excel | Nobody knows who is on which plan or when it expires | Members module, entitlements, expiry reminders |
| Bar receipts on paper | Lost tabs, kitchen confusion, no daily total | Bar POS with tabs, kitchen tickets, auto-discounts |
| Court availability by phone | Staff overwhelmed | Live slot grid for staff, members and the public website |
| No visibility into revenue | Owner "losing money" | Live owner dashboard fed by one payments ledger |

**Hackathon goals.**

1. A **working end-to-end demo** that crosses modules (see section 9).
2. A **booking engine that cannot double-book**, with every pricing and limit rule enforced.
3. A **live owner dashboard** that moves while the judges watch.
4. A **clean, consistent UI** built on the repo's existing design system.

**Success criteria (what we check before submission).**

- [ ] 20 parallel booking requests for the same court and slot produce exactly 1 success and 19 `409 SLOT_TAKEN`.
- [ ] A member's 3rd booking on one day is rejected with `422 DAILY_LIMIT_REACHED`.
- [ ] Gold, Silver, Junior and walk-in see four different prices for the same slot.
- [ ] Selling the last unit at the counter makes the website show "Sold out" and fires a low-stock notification.
- [ ] A bar tab with a member auto-discounts, sends a kitchen ticket, settles by UPI, and appears in the dashboard's bar revenue within 10 seconds.
- [ ] A website enquiry becomes a lead, a quote, a member, a membership and an invoice, each step visible in the UI.
- [ ] `pnpm verify` is green on `main` before the submission build.

---

## 2. Understanding The Champions Club

### 2.1 The physical club

| Area | What it does | Module |
| --- | --- | --- |
| Courts | Hourly sessions, members book, walk-ins pay more | Court Booking |
| Gear shop | Rackets, balls, shoes, accessories, apparel (S3) | Shop / Inventory |
| Bar and cafeteria | Food and drink after matches (S4) | Bar POS |
| Front desk | Walk-ins, phone calls, staff schedules [M] | Members, Booking, HR |

### 2.2 Inconsistency in the PDF (flagged)

- Section 1 describes "a thriving **tennis, padel and badminton** club".
- Section 2 says the club has "**tennis and cricket** courts".
- No scene names a sport.

**Assumption:** the sport is data, not code. We build a `court_types` table and seed **four types: Tennis, Padel, Badminton, Cricket Nets**, two courts each (8 courts). The engine is identical for all of them. If the organisers confirm one reading, we delete rows, not code. The demo leads with Tennis and Padel and mentions Cricket Nets as proof of flexibility.

### 2.3 The three tiers and proposed entitlements **(ADDITION: the PDF gives tiers but no numbers)**

All prices in INR, stored as integer paise. Walk-in rates are the base price.

| Entitlement | Gold (premium, full access) | Silver (standard) | Junior (under 18, discounted) | Walk-in / guest |
| --- | --- | --- | --- | --- |
| Monthly fee | ₹3,000 | ₹1,500 | ₹800 | none |
| Court price (base ₹600/h tennis) | **Free play** (100% off) | 30% off (₹420) | 50% off (₹300) | ₹600 |
| Shop discount | 15% | 8% | 10% | 0% |
| Bar and cafeteria discount | 10% | 5% | 5% | 0% |
| Max bookings per day | 2 | 2 | 2 | no member limit |
| Booking horizon (days ahead) | 14 | 7 | 7 | 2 |
| Friday social play fee (per head) | Free | 30% off | 50% off | full fee |
| Eligibility | any adult | any adult | under 18, needs date of birth | n/a |

The numbers live in the `plans` table and are edited by the Owner. Nothing is hard-coded. [S1]

---

## 3. User personas

| Persona | Who | Core needs | Main screens | Role name |
| --- | --- | --- | --- | --- |
| **Owner** | Club owner | "How much did we earn, from where, what do we owe?" Approve leave, see everything | Dashboard, Reports, Invoices, HR, Plans | `OWNER` |
| **Front-desk staff** | Counter and phone | Recognise members fast, book courts for walk-ins and callers, sell gear, follow up leads | Desk home, Schedule grid, Member profile, Shop POS, CRM | `FRONT_DESK` |
| **Bar / kitchen staff** | Bartenders, cooks | Open tabs, send orders, see what to cook, settle payments, clock shifts | Bar floor, Kitchen board, My shift | `BAR_STAFF` |
| **Member** | Gold/Silver/Junior | Book courts, see membership and expiry, order gear | Member home, Book a court, Orders | `MEMBER` |
| **Walk-in guest** | No account | Play today, pay full price | Handled by front desk (guest name + phone on the booking) | none |
| **Website visitor / lead** | Stranger searching online | See plans, free slots, shop; book a trial; send an enquiry | Public website | none (public) |

Existing repo roles `ADMIN` and `USER` and the `ROOT` identity remain. `ROOT` and `ADMIN` can do everything the Owner can. New domain roles are added in `packages/config/src/iam-config.ts` (see ARCHITECTURE_AND_DATABASE.md).

---

## 4. Scene-by-scene breakdown

Feature IDs (e.g. `MEM-3`) are defined in section 5 and reused in the API, UI and task documents.

### Scene 1: A new member walks in [S1]

**Problem.** Staff must know who the person is, which plan they are on, what it entitles them to, when it expires, and recognise them later with their history.

**Features.** `MEM-1` register member + choose plan · `MEM-2` plan entitlements · `MEM-3` member code and fast search · `MEM-4` history timeline · `MEM-5` expiry status and reminders · `MEM-6` renew / change / cancel plan · `MEM-7` check-in · `MEM-8` photo (NICE).

**Business rules.** BR-05, BR-07, BR-09, BR-12 (section 6).

**Acceptance criteria.**

- Front desk fills one form (name, phone, email, date of birth, plan, payment mode) and gets a member code like `CC-000123`, an active membership, and a PAID invoice. One short form, no second screen.
- A Junior plan is refused if the date of birth makes the person 18 or older (`422 JUNIOR_AGE_INVALID`).
- Searching by name, phone or member code returns matches as you type; the profile shows plan, expiry date, days left, entitlements, and a timeline of check-ins, bookings, shop orders, bar tabs and invoices.
- A membership expiring within 7 days shows an amber badge; expired shows a red badge.
- Reminders are created at 30, 7 and 1 day before expiry and on the day it lapses. Each creates an in-app notification for the member and a task for the front desk. Email is sent only when `RESEND_API_KEY` is set.

### Scene 2: Booking a court on a busy evening [S2]

**Problem.** Walk-in at the counter, WhatsApp messages and a phone call all at once. One-hour sessions, a new slot every 30 minutes, max two plays per member per day, price depends on plan, plans change, people cancel, Friday social play, and **never two people on one court at the same time**.

**Features.** `BKG-1` live availability grid · `BKG-2` create booking (member, walk-in, phone) · `BKG-3` pricing by plan · `BKG-4` daily limit · `BKG-5` cancel with rules · `BKG-6` Friday social play · `BKG-7` maintenance block · `BKG-8` member self-service booking · `BKG-9` auto-refresh · `BKG-10` reschedule (NICE).

**Business rules.** BR-01 to BR-11.

**Acceptance criteria.**

- The grid shows every court by every half-hour start time, coloured Free / Booked / Social / Blocked, and refreshes at least every 10 seconds.
- Two simultaneous requests for the same court and overlapping time: one succeeds, the other gets `409 SLOT_TAKEN`. This holds under 20 parallel requests (an automated test proves it).
- Court 1 booked 18:00–19:00 means 18:30 on Court 1 is not bookable, but 18:30 on Court 2 is. 19:00 on Court 1 is bookable (touching ranges do not overlap).
- A member's 3rd active booking that day is rejected; cancelling an early booking frees the quota, a late cancellation does not.
- The same slot shows ₹0 / ₹420 / ₹300 / ₹600 to Gold / Silver / Junior / walk-in.
- On Friday 18:00–22:00 courts show as Social with "5 of 8 spots left"; joining fills a spot; the 9th person is refused (`409 SOCIAL_FULL`); nobody can book that court exclusively.
- Downgrading a plan takes effect at the next renewal; upgrading is immediate with a prorated top-up invoice.

### Scene 3: Gearing up before a match [S3]

**Problem.** A string snaps ten minutes before play; another member wants shoes ordered from home with pickup or delivery. Counter and online must share one shelf and the club must see low stock.

**Features.** `SHP-1` catalogue · `SHP-2` stock ledger · `SHP-3` counter POS · `SHP-4` online order (click-and-collect or delivery) · `SHP-5` low-stock alerts · `SHP-6` fulfilment board · `SHP-7` restock · `SHP-8` member discount.

**Business rules.** BR-13 to BR-15.

**Acceptance criteria.**

- Stock is one number per product. A counter sale and an online order both reduce it atomically; stock can never go below zero, even with two buyers racing for the last unit (one gets `409 OUT_OF_STOCK`).
- At or below the reorder level, a notification is raised once and the Inventory page flags the product.
- A logged-in member sees their discounted price in the cart without entering a code.
- An online order has status PLACED → READY → COLLECTED (pickup) or PLACED → OUT_FOR_DELIVERY → DELIVERED; the front desk board shows what to prepare. Cancelling restores stock.

### Scene 4: After the match, at the bar [S4]

**Problem.** Twenty people at once, paper orders, lost tabs, the kitchen asks who ordered what; members expect auto-discounts; some run a tab; payments by cash, card or UPI; shifts; table tracking; daily earnings.

**Features.** `BAR-1` menu · `BAR-2` tables · `BAR-3` tabs · `BAR-4` kitchen tickets · `BAR-5` auto-discount · `BAR-6` settle by cash/card/UPI · `BAR-7` staff shifts · `BAR-8` daily bar earnings · `BAR-9` split payment (NICE).

**Business rules.** BR-16 to BR-19.

**Acceptance criteria.**

- Staff open a tab (member by search, or guest name) on a table, add items, and press "Send to kitchen"; a ticket appears on the Kitchen board showing table, tab name and items, and moves NEW → PREPARING → READY → SERVED.
- A member's tab shows the discount per line automatically; a guest's does not.
- Settling a tab asks only for the payment mode; it can be settled once; the table frees up.
- Staff clock in and out of a scheduled shift; each payment records who took it and in which shift.
- "Bar earnings today" shows total, by payment mode and by shift, and matches the dashboard.

### Scene 5: A stranger finds the club online [S5]

**Problem.** No website, so nobody finds the club. A visitor should see the club, plans and prices, free slots this week and the shop, book a trial, and send an enquiry that never vanishes.

**Features.** `WEB-1` home · `WEB-2` plans and prices · `WEB-3` live free slots · `WEB-4` trial booking · `WEB-5` shop browse · `WEB-6` enquiry form · `WEB-7` signup and online ordering · `CRM-1` lead capture · `CRM-2` notify staff · `CRM-3` pipeline · `CRM-4` follow-up · `CRM-5` quote · `CRM-6` convert to member · `CRM-7` activity log.

**Business rules.** BR-20, plus BR-02/BR-03 (the website uses the same engine).

**Acceptance criteria.**

- A signed-out visitor sees plans (from the `plans` table), this week's free slots (same endpoint the desk uses) and in-stock products.
- Booking a trial needs only name, phone, email and a slot; it creates a booking and a lead. Max one trial per phone number.
- The enquiry form creates a lead, a notification reaches the front desk, and the lead shows in the CRM within 10 seconds.
- Staff set a follow-up date, add notes, send a quote, and with one click convert the lead into a member, which creates the membership and invoice.

### Scene 6: The owner, at the end of the month [S6]

**Problem.** "How much did we earn, from where, and what do we owe?" Money from courts, shop and bar, by card, cash and online; memberships and business clients to invoice; employees, leave, taxes; today, this week, this month; shareable.

**Features.** `ACC-1` payments ledger · `ACC-2` membership invoices · `ACC-3` business-client invoices · `ACC-4` printable invoice · `ACC-5` tax summary · `ACC-6` employees · `ACC-7` leave approval · `ACC-8` payroll summary · `DSH-1…DSH-9` dashboard.

**Business rules.** BR-21 to BR-24.

**Acceptance criteria.**

- One dashboard with a Today / This week / This month switch, showing total revenue, revenue by source (Courts, Shop, Bar, Memberships), revenue by payment mode (Cash, Card, UPI), a trend chart, court utilisation, and "what we owe" (tax payable, payroll due, unpaid invoices).
- Every payment taken anywhere in the system appears here without any manual step; refunds subtract.
- A business client can be invoiced with custom lines, the invoice has a printable page, and it moves DRAFT → SENT → PAID.
- Employees can request leave; the Owner approves or rejects; overlaps with approved leave are refused.
- The Owner can export the period as CSV and create a read-only share link that expires in 7 days.

---

## 5. Module-by-module feature list

Tags: **MUST** = demo fails without it · **SHOULD** = do after all MUST items · **NICE** = only with spare time. Scoped realistically for two people.

### 5.1 Members [S1]

| ID | Feature | Tag |
| --- | --- | --- |
| MEM-1 | Register member at the desk (profile, plan, payment) | MUST |
| MEM-2 | Plans with entitlements, editable by Owner | MUST |
| MEM-3 | Member code and instant search (name, phone, code) | MUST |
| MEM-4 | Member profile with history timeline | MUST |
| MEM-5 | Expiry status badge, daily expiry job, reminders (in-app) | MUST |
| MEM-6 | Renew, upgrade (prorated), scheduled downgrade, cancel | SHOULD |
| MEM-7 | Check-in button at the desk (logs a visit) | SHOULD |
| MEM-8 | Member photo upload to MinIO via `StorageService` | NICE |
| MEM-9 | Junior turns 18 prompt | NICE |

### 5.2 Court Booking [S2]

| ID | Feature | Tag |
| --- | --- | --- |
| BKG-1 | Availability grid (courts × half-hour starts) | MUST |
| BKG-2 | Create booking for member, walk-in guest, phone caller | MUST |
| BKG-3 | Pricing by plan, free play, price snapshot | MUST |
| BKG-4 | Max 2 per member per day | MUST |
| BKG-5 | Cancel with cutoff rule and refund | MUST |
| BKG-6 | Friday social play with capacity | MUST |
| BKG-7 | Owner blocks a court for maintenance | SHOULD |
| BKG-8 | Member self-service booking and "My bookings" | MUST |
| BKG-9 | Polling refresh every 10 seconds | MUST |
| BKG-10 | Reschedule | NICE |
| BKG-11 | Social waitlist | NICE |

### 5.3 Shop and Inventory [S3]

| ID | Feature | Tag |
| --- | --- | --- |
| SHP-1 | Product catalogue with categories and images (image URL field; upload NICE) | MUST |
| SHP-2 | Stock ledger (`stock_movements`) and atomic decrement | MUST |
| SHP-3 | Counter POS (cart, member lookup, pay) | MUST |
| SHP-4 | Online order with pickup or delivery | MUST |
| SHP-5 | Low-stock alert and Inventory flag | MUST |
| SHP-6 | Fulfilment board (prepare, ready, collected, delivered) | SHOULD |
| SHP-7 | Restock form | SHOULD |
| SHP-8 | Automatic member discount | MUST |

### 5.4 Bar POS [S4]

| ID | Feature | Tag |
| --- | --- | --- |
| BAR-1 | Menu items and categories | MUST |
| BAR-2 | Table list with status (Free, Occupied) | MUST |
| BAR-3 | Tabs (open, add items, settle) | MUST |
| BAR-4 | Kitchen tickets with status flow | MUST |
| BAR-5 | Automatic member discount | MUST |
| BAR-6 | Settle by cash, card, UPI | MUST |
| BAR-7 | Staff shifts (schedule, clock in/out) | SHOULD |
| BAR-8 | Daily bar earnings and closing report | MUST |
| BAR-9 | Split payment across modes | NICE |

### 5.5 Website [S5]

| ID | Feature | Tag |
| --- | --- | --- |
| WEB-1 | Home page (club, hours, call to action) | MUST |
| WEB-2 | Plans and prices from the database | MUST |
| WEB-3 | Live free slots for the next 7 days | MUST |
| WEB-4 | Trial booking without an account | MUST |
| WEB-5 | Shop browse with live stock | MUST |
| WEB-6 | Enquiry form | MUST |
| WEB-7 | Member signup/login, online order checkout | SHOULD |

### 5.6 CRM [S5]

| ID | Feature | Tag |
| --- | --- | --- |
| CRM-1 | Lead capture from enquiry and trial | MUST |
| CRM-2 | In-app notification to staff on new lead | MUST |
| CRM-3 | Lead list and status pipeline | MUST |
| CRM-4 | Follow-up date and "due today" filter | MUST |
| CRM-5 | Quote (plan, amount, validity) | SHOULD |
| CRM-6 | Convert lead to member (membership and invoice in one transaction) | MUST |
| CRM-7 | Activity notes per lead | SHOULD |

### 5.7 Accounting and HR [S6]

| ID | Feature | Tag |
| --- | --- | --- |
| ACC-1 | Unified `payments` ledger with source and mode | MUST |
| ACC-2 | Auto-invoice on membership purchase | MUST |
| ACC-3 | Invoices for business clients with custom lines | SHOULD |
| ACC-4 | Printable invoice page | SHOULD |
| ACC-5 | Tax summary (simplified, see section 8) | SHOULD |
| ACC-6 | Employees list | SHOULD |
| ACC-7 | Leave request and approval | SHOULD |
| ACC-8 | Payroll summary (monthly salary liability, no payslips) | NICE |
| ACC-9 | Expenses | NICE |

### 5.8 Owner dashboard [S6]

| ID | Feature | Tag |
| --- | --- | --- |
| DSH-1 | KPI cards for Today / Week / Month | MUST |
| DSH-2 | Revenue by source | MUST |
| DSH-3 | Revenue by payment mode | MUST |
| DSH-4 | Revenue trend chart | MUST |
| DSH-5 | "What we owe" panel | SHOULD |
| DSH-6 | CSV export | SHOULD |
| DSH-7 | Read-only share link | SHOULD |
| DSH-8 | Auto-refresh every 10 seconds | MUST |
| DSH-9 | Court utilisation percentage | SHOULD |

**Cut line.** If the MUST list is not green close to the end, drop in this order: ACC-9, ACC-8, MEM-8, BAR-9, DSH-7, ACC-3, ACC-7, CRM-7, BKG-7.

---

## 6. Business rules (precise)

Times are in the club time zone, `Asia/Kolkata` **(ADDITION: assumed because UPI is listed; configurable via a new `CLUB_TIMEZONE` setting)**. Money is integer paise.

### Time and slots

- **BR-01 Opening hours.** 06:00–22:00 daily (assumption, stored in `system_settings` key `club.hours`). The last bookable start is the closing time minus 60 minutes, so every session ends by closing.
- **BR-02 Session shape.** Every session is exactly 60 minutes. A new bookable start opens every 30 minutes (`:00` and `:30`). Starts at any other minute are rejected (`422 INVALID_SLOT_START`).
- **BR-03 No overlap (hard guarantee).** Two active sessions on the same court may never overlap. Ranges are half-open `[start, end)`, so 18:00–19:00 and 19:00–20:00 coexist, and 18:00–19:00 and 18:30–19:30 do not. Enforced by a PostgreSQL exclusion constraint, not only by application code (ARCHITECTURE_AND_DATABASE.md section 3). **(ADDITION)** A member also cannot hold two overlapping sessions on different courts.

### Limits and pricing

- **BR-04 Daily limit.** A member may hold at most **2 active bookings per club-local day**, counted by session start date. Social-play joins count. A booking is "active" if it is CONFIRMED, COMPLETED or NO_SHOW, or CANCELLED late (see BR-08). A cancelled-in-time booking does not count. Walk-in guests have no daily limit (the PDF limits members only).
- **BR-05 Price.** `price = round(court_type.base_rate × (100 − plan.court_discount_pct) / 100)`. Walk-ins and guests pay `base_rate`. "Free play" means `court_discount_pct = 100`, so the price is 0, the booking is `payment_status = WAIVED`, and it still occupies the court and still counts toward BR-04. The price is **snapshotted on the booking** so later plan changes never rewrite history.
- **BR-06 Booking horizon.** A member cannot book further ahead than their plan's `booking_horizon_days`; walk-in guests booked by staff 2 days; trial bookings and the public availability grid 7 days.
- **BR-07 Membership validity.** Member pricing requires an ACTIVE membership on the session date. If the membership ends before the session date, the booking is refused with `422 MEMBERSHIP_EXPIRES_BEFORE_SLOT` and a "renew first" hint. An expired member keeps the profile and history and books at walk-in price.

### Cancellations, plan changes

- **BR-08 Cancellation.** Cancelling **at least 2 hours before start** (`system_settings` key `booking.cancel_cutoff_hours`) frees the court, frees the daily quota, and refunds any payment (a negative `payments` row). Cancelling **less than 2 hours before** frees the court (so someone else can play) but gives **no refund and keeps the quota used**. Front desk and Owner can override with a written reason, which is audited. No-shows are marked by staff and count toward the quota.
- **BR-09 Plan changes.** *Upgrade* (for example Silver → Gold): immediate; a top-up invoice of `round((new_fee − old_fee) × remaining_days / term_days)`; the term end date is unchanged. *Downgrade*: recorded as `pending_plan_id` and applied at the next renewal. *Renew*: starts the day after the current term ends (or today if expired) for 30 days. *Cancel membership*: stays ACTIVE until `ends_on`, no renewal, no refund. Every change writes a `membership_events` row.

### Friday social play

- **BR-10 Social windows.** The Owner defines social windows in the `social_windows` table; default **Friday 18:00–22:00**, applying to all courts. Inside a window:
  - Courts run **shared sessions in fixed one-hour blocks starting on the hour** (18:00, 19:00, 20:00, 21:00). The half-hour start rule is suspended here so shared sessions never overlap each other.
  - Each court has `social_capacity` (default 8 for Tennis and Cricket Nets, 4 for Padel, 6 for Badminton).
  - Each participant is a booking row of kind SOCIAL. A **social session** is created on the first join. Capacity is enforced with a row lock: the 9th person gets `409 SOCIAL_FULL`.
  - Price per head = `court_type.social_fee_paise` reduced by the plan's court discount (Gold free). Joining counts toward BR-04. A person may join a given session once and cannot join two overlapping sessions.
  - The whole court-hour is held in the same occupancy table as ordinary bookings, so an exclusive booking cannot overlap a social session. Exclusive bookings inside a window are refused (`409 SOCIAL_WINDOW`) unless the Owner disables social mode for that court and date.
  - Cancelling follows BR-08.

### Walk-ins and trials

- **BR-11 Guests.** A walk-in or phone booking carries `guest_name` and `guest_phone` instead of a member. It pays the base rate and records payment mode when paid. **(ADDITION)** A website **trial** booking is priced at the court type's `trial_fee_paise`, limited to **one per phone number**, and creates a lead.

### Membership lifecycle

- **BR-12 Expiry.** A membership is ACTIVE through the end of `ends_on` (club-local). A daily job marks it EXPIRED at 00:00 the next day (no grace period, assumption). Reminders are created at **30, 7 and 1 days before** and **on expiry**, once each (unique key on membership + kind). Expired members are flagged in search results and on the desk.

### Shop

- **BR-13 One shelf.** Each product has one `stock_qty`. Every sale (counter or online) decrements it with a guarded statement (`WHERE stock_qty >= :qty`); if no row updates, the sale fails with `409 OUT_OF_STOCK`. Every change writes a `stock_movements` row (reason: SALE_COUNTER, SALE_ONLINE, RESTOCK, ADJUSTMENT, CANCEL_RETURN). Online orders **reserve by decrementing at placement**; cancelling or letting an unpaid online order lapse for 2 hours **(SHOULD)** returns the stock. Low stock: when `stock_qty <= reorder_level`, one notification is created and `low_stock_alerted_at` is set; restocking above the level clears it.
- **BR-14 Shop discount.** Members get `plan.shop_discount_pct` on products with `discountable = true`, applied server-side at order time and snapshotted on the line. Guests pay list price.
- **BR-15 Online orders.** Fulfilment is PICKUP (free) or DELIVERY (flat ₹50 fee **(ADDITION)**, address required). Payment is "pay on pickup/delivery" or UPI (simulated). Status flow: PICKUP `PLACED → READY → COLLECTED`; DELIVERY `PLACED → OUT_FOR_DELIVERY → DELIVERED`; either can go to `CANCELLED` before the final state.

### Bar

- **BR-16 Tabs and tables.** A tab belongs to a member or a guest name, and optionally to one table. A table can have at most one OPEN tab. Items added to a tab are snapshotted with their price and discount. "Send to kitchen" groups the unsent items into one **kitchen ticket**. A tab can be settled once (idempotent); settling frees the table. Voiding an item after it is SERVED needs the Owner.
- **BR-17 Bar discount.** Members get `plan.bar_discount_pct` on items with `discountable = true`, applied automatically when the item is added.
- **BR-18 Payment modes.** Only CASH, CARD, UPI. Online/website payments are UPI in this build. Every payment stores `source` (COURT, SHOP, BAR, MEMBERSHIP, INVOICE), `source_id`, `received_by` and `shift_id` when a shift is open.
- **BR-19 Shifts.** A `staff_shift` is scheduled (start, end, role). Staff clock in and out against it. Bar earnings for a day = net payments with source BAR on that club-local day, grouped by mode and shift.

### CRM and accounting

- **BR-20 Leads.** Sources: WEBSITE_ENQUIRY, WEBSITE_TRIAL, WALK_IN, PHONE, REFERRAL. Status flow: `NEW → CONTACTED → QUOTED → WON | LOST`. A quote is valid for 14 days. **Convert** (inside one database transaction) creates the member, the membership, and a PAID invoice, links them to the lead, and marks it WON. Converting twice returns `409 ALREADY_CONVERTED`.
- **BR-21 Invoices.** Number format `INV-YYYY-NNNN` from a PostgreSQL sequence. Membership purchase at the desk creates a PAID invoice immediately. A business-client invoice is DRAFT → SENT → PAID (or VOID), due 15 days after issue **(assumption)**. An invoice is PAID when its payments sum to its total.
- **BR-22 Tax (simplified).** Prices are tax-inclusive. Tax rates are per source, stored in `system_settings` key `tax.rates` (default basis points: COURT 1800, SHOP 1800, BAR 500, MEMBERSHIP 1800, INVOICE 1800). Tax on a payment = `round(amount × rate / (10000 + rate))`. The tax summary is computed from the payments ledger at report time.
- **BR-23 Leave.** An employee requests leave for a date range; the Owner approves or rejects. A request that overlaps an approved one is refused. Approved leave appears on the shift roster.
- **BR-24 Reporting periods.** "Today" = club-local day. "Week" = Monday to Sunday containing today. "Month" = calendar month. Revenue = payments minus refunds, counted on the day the payment was recorded.

---

## 7. How modules connect (why this scores)

Every module writes into the same few tables, so nothing is re-typed:

- A **booking** writes `bookings` + `court_occupancies`, and a **payment** row when paid.
- A **shop sale** (counter or online) writes `orders`, `order_items`, `stock_movements`, `payments`.
- A **bar tab** writes `tabs`, `tab_items`, `kitchen_tickets`, `payments`.
- A **membership** purchase writes `memberships`, `membership_events`, `invoices`, `payments`.
- A **website enquiry or trial** writes `leads` and `notifications`; **convert** writes `members`, `memberships`, `invoices`, `payments`.
- The **owner dashboard** reads only `payments`, `bookings`, `invoices`, `employees`: no manual entry.

---

## 8. What we deliberately simplify or fake

| Area | What we do | Why |
| --- | --- | --- |
| Online payments | UPI "Pay now" is a simulated success; the payment is still recorded with mode UPI | No gateway keys, no time; the ledger is what matters |
| Card and cash | The cashier chooses the mode; nothing is processed | PDF only needs recording |
| Email and SMS | In-app notifications always; email only if `RESEND_API_KEY` is set (`enableEmail` flag), otherwise logged | Feature flag already exists in the repo |
| GST | One inclusive rate per source, no HSN, no input credit, no GSTIN checks | Enough to show "taxes to report" |
| Payroll | Monthly salary liability only; no payslip PDFs, no deductions | PDF only says "employees to pay" |
| Delivery | Flat fee and status flow; no courier tracking | Out of scope |
| Realtime | Polling every 10 seconds, no WebSockets | Reliable and simple; looks live in a demo |
| Dashboard sharing | Read-only token link to a live view, expiring in 7 days | Meets "share the numbers" cheaply |
| Photos and QR | Photo upload NICE; member code instead of QR scanning | Fast recognition without a camera flow |
| Dynamic pricing | No peak/off-peak pricing | Not in the PDF |
| Single club | One location, one time zone | Matches the PDF |

---

## 9. Winning differentiators and how to demo them

The demo is scripted. **(Judging format unknown: a short version skips the steps marked optional.)**

1. **A booking engine that cannot be broken (court booking, S2).**
   - Show the grid, book Court 1 at 18:00 as a Silver member (₹420), then try Court 1 at 18:30 (refused).
   - **Live concurrency test:** a button on an admin-only demo page fires 20 parallel requests for one slot; the result panel shows `1 confirmed · 19 SLOT_TAKEN`.
   - Show the 3rd-booking-of-the-day refusal and the four prices.
   - Switch the clock to Friday (a demo `?asOf=` query on the availability endpoint **(ADDITION, dev only)**) to show social play filling to 8.
2. **One shelf, two doors (S3).**
   - A shoe has stock 1. Open the website `/shop` in one window and the counter POS in another. Sell it at the counter. The website flips to "Sold out" within 10 seconds, a low-stock notification pops in the desk bell, and the Inventory page flags it.
3. **A dashboard that moves (S6).**
   - Keep the Owner dashboard on a second screen from the start. Every demo step (booking paid, shoe sold, bar tab settled) bumps the revenue-by-source bars and payment-mode donut within 10 seconds. Finish with the share link and CSV.
4. **Enquiry to member in one flow (S5 → S1).**
   - Submit the website enquiry on a phone; the lead appears at the desk; send a quote; click Convert; the member, plan, invoice and expiry date appear, and the new member books a court.

**Demo data** (seeded by a deterministic seed extension): 8 courts, 4 plans, 40 members across tiers (some expiring in 3 and 20 days), 30 products (3 low on stock), 25 menu items, 10 tables, 12 days of historical payments so charts are not empty, 6 leads in various states, 5 employees.

---

## 10. Assumptions and open questions

**Assumptions (we proceed with these unless told otherwise).**

1. The submission deadline and judging format are **not yet provided** (placeholders: `[date and time]`, `[online/offline, demo length]`). The scope is sized for a short event with two people.
2. Currency INR, time zone `Asia/Kolkata`, one club location.
3. Sports are data: Tennis, Padel, Badminton, Cricket Nets, two courts each (section 2.2).
4. Entitlement numbers in section 2.3 are ours; the PDF gives the tiers only.
5. A Gold "free play" is capped by the same 2-per-day limit.
6. Social play is Friday 18:00–22:00 in hourly blocks; capacity differs by sport.
7. Cancellation cutoff is 2 hours; late cancellations keep the quota used.
8. Members pay for courts at the desk or "on arrival" (recorded when paid); there is no pre-payment hold.
9. The club is VAT/GST-registered at a flat rate per source.
10. Members may log in; walk-ins never have accounts.

**Open questions for the organisers or mentors.**

1. Tennis and cricket (section 2) or tennis, padel and badminton (section 1)?
2. Is online payment required to be real, or is a recorded mock acceptable?
3. Is the demo live or recorded, and are there limits on how it is presented?
4. Is there a required deployment target (public URL), or is a local demo acceptable?
5. Should members of different tiers have different daily limits? (We assume no.)
6. Are cricket courts shared as lanes (several nets per court) or one booking per ground? (We assume one booking per net.)
