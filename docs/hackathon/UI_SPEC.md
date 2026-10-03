# UI_SPEC.md (for Khushi)

> Everything here uses what the repo already has: Next.js App Router in `apps/web/src/app/`, the three route groups `(marketing)`, `(auth)`, `(app)`, shadcn components in `components/ui/`, the app shell in `components/app-shell/`, TanStack Query hooks in `hooks/`, and the typed `api` object in `lib/api-client.ts`.
> **Read first:** `skills/design/SKILL.md` Its rules are summarised in section 2 and they are enforced in review.
> Data contracts are in `API_CONTRACT.md`; the mock JSON you build against must match them exactly.

---

## 1. Navigation and roles

The sidebar (`components/app-shell/sidebar.tsx`) already hides items with `show: false`. Extend its `sections` array; each item uses `hasPermission(...)` exactly like the existing `canAccessAdmin`. **One icon per destination, no other icons** (design skill section 5).

| Sidebar section | Item | Route | Shown when | Icon (lucide) |
| --- | --- | --- | --- | --- |
| Workspace | Home | `/dashboard` | always | `LayoutDashboard` |
| Workspace | Courts | `/courts` | `courts:read` or member | `CalendarDays` |
| Workspace | Bookings | `/bookings` | `bookings:read` or `bookings:read:self` | `Ticket` |
| Workspace | Membership | `/membership` | member only | `IdCard` |
| Front desk | Members | `/members` | `members:read` | `Users` |
| Front desk | Counter sale | `/pos` | `orders:create` | `ShoppingCart` |
| Front desk | Orders | `/orders` | `orders:read` or `orders:read:self` | `Package` |
| Front desk | Inventory | `/inventory` | `inventory:read` | `Boxes` |
| Front desk | Leads | `/crm` | `crm:read` | `Contact` |
| Bar | Floor | `/bar` | `bar:read` | `Armchair` |
| Bar | Kitchen | `/bar/kitchen` | `bar:kitchen` | `ChefHat` |
| Bar | Earnings | `/bar/earnings` | `bar:read` | `Receipt` |
| Club | Shifts | `/shifts` | `shifts:read` | `Clock` |
| Club | Invoices | `/invoices` | `invoices:read` | `FileText` |
| Club | Staff and leave | `/hr` | `hr:read` or `leave:read:self` | `BriefcaseBusiness` |
| Club | Reports | `/reports` | `reports:read` | `ChartColumn` |
| Administration | Club settings | `/admin/club` | `admin:access` | `Settings` |
| Administration | Access (IAM) | `/admin` | `admin:access` (existing) | `ShieldCheck` |

The topbar gets one new element: a **notification bell** (icon-only `Button variant="ghost" size="icon"` with `aria-label="Notifications"` and a count `Badge`) that polls `GET /notifications/unread-count` every 10 seconds and opens a `DropdownMenu` with the latest 8 from `GET /notifications`.

**What each role sees first (`/dashboard`):**

| Role | `/dashboard` shows | Endpoints |
| --- | --- | --- |
| MEMBER | Membership card, next booking, quick "Book a court" and "Shop" links | `GET /me/member`, `GET /me/bookings?scope=upcoming&limit=3` |
| FRONT_DESK | Member search box, today's bookings count, low-stock count, new leads | `GET /members/lookup`, `GET /bookings?date=today`, `GET /inventory/low-stock`, `GET /crm/summary` |
| BAR_STAFF | Open tabs count, tickets waiting, current shift with clock in/out | `GET /bar/tabs?status=OPEN`, `GET /bar/tickets`, `GET /me/shift/current` |
| OWNER | Redirect link to `/reports` plus alert counts | `GET /reports/dashboard?range=today` (`alerts`) |

Implement `/dashboard/page.tsx` as `if (hasPermission('reports:read')) … else if …` rendering one small component per role. Keep the existing account card under them.

---

## 2. Design system (built on the existing tokens)

**Theme:** Zinc and Emerald, IBM Plex Sans / IBM Plex Mono, radius `--radius` 0.375rem, light and dark. Tokens in `apps/web/src/app/globals.css`; Tailwind names in `tailwind.config.ts`. **Never write a literal Tailwind colour** (`bg-green-500`, `text-red-600`). Use tokens.

### 2.1 Colour roles

| Use | Token classes |
| --- | --- |
| Page, cards | `bg-background`, `bg-card text-card-foreground`, `border` |
| Secondary text | `text-muted-foreground` |
| The one main action on a screen | `Button` default (`bg-primary`) |
| Secondary actions | `variant="outline"`, `variant="ghost"` |
| Dangerous actions (cancel, void) | `variant="destructive"` |
| Good / OK / paid / in stock | `text-success`, `Badge variant="success"` |
| Warning / expiring / low stock / pending | `text-warning`, `Badge variant="warning"` |
| Error / expired / out of stock / overdue | `text-destructive`, `Badge variant="destructive"` |
| Neutral status (draft, done) | `Badge variant="secondary"` or `outline` |

Status colours always come with a text label (never colour alone).

**Tier badges:** no new hues. Gold: `Badge` default, Silver: `secondary`, Junior: `outline`.

**Chart tokens (small ADDITION to `globals.css`, light and dark):** add `--chart-1` to `--chart-4` and expose them in `tailwind.config.ts` as `chart.1`…`chart.4`. Use shades of the theme (emerald `158 64% 30%` family and zinc `240 4% 46%` family), for example `--chart-1: 158 64% 30%; --chart-2: 158 40% 48%; --chart-3: 240 4% 46%; --chart-4: 240 5% 75%`. Source, mode and series colours then come from these four tokens, with labels directly on or beside the bars so no legend colour-matching is needed.

### 2.2 Slot grid status styling (tokens only)

| Slot status | Classes | Label shown |
| --- | --- | --- |
| `FREE` | `border bg-background hover:border-primary hover:bg-primary/5` | price, e.g. "₹420" |
| `FREE` (selected) | `border-primary bg-primary text-primary-foreground` | price |
| `BOOKED` | `bg-muted text-muted-foreground cursor-not-allowed` | "Booked" (staff: holder name) |
| `BLOCKED` | `bg-muted text-muted-foreground line-through` | "Blocked" |
| `SOCIAL_OPEN` | `border-success/25 bg-success/10 text-success` | "3 of 8 left" |
| `SOCIAL_FULL` | `border-warning/25 bg-warning/10 text-warning` | "Full" |
| `PAST` | `opacity-40 cursor-not-allowed` | none |

### 2.3 Typography (design skill section 4)

| Role | Class |
| --- | --- |
| Page title | `PageHeader` (already `text-2xl font-semibold tracking-tight`) |
| Section heading | `text-lg font-semibold` or `CardTitle` |
| Body | default size; secondary text `text-sm text-muted-foreground` |
| Big KPI number | `text-3xl font-semibold tabular` |
| Money and counts in tables | add `tabular` and align right |
| Identifiers (member code, invoice number, order number) | `font-mono text-xs` |

### 2.4 Spacing, layout, components

- 4px scale only: `space-y-8` between page sections, `space-y-4` inside, `gap-2` for related controls, `gap-4` between cards, cards `p-6` (the `Card` default).
- Content only: the `(app)` layout owns width, nav and auth. **Never** add `container`, `max-w-*` on the page, or your own nav.
- Every `(app)` page starts with one `<PageHeader title description actions />`. Title in sentence case; description is one plain sentence; at most two actions.
- Use `<dl className="divide-y">` for key/value data (see the dashboard page's `Field` helper), a `Table` for more than ~8 rows, and a card only when it holds a real group of content.
- Buttons: sentence case, start with a verb ("Book court", "Settle tab"). Primary action uses `default`; table-row actions use `size="sm" variant="outline"`; icon-only buttons need `aria-label`.
- Forms: `react-hook-form` + `zodResolver` with the shared schema; each field is `Label` + `Input`; inline error under the field with `role="alert"`; submit button disabled while pending; success shows `toast.success(...)`, failure shows `toast.error(error.message)`.
- Dialogs for confirmations and small forms (cancel booking, add item, restock). Full pages for anything with more than 5 fields.
- Money: always through one helper `formatMoney(paise)` in `src/lib/format.ts` (`Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` on `paise / 100`). Dates: `formatDateTime(iso)` using `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ... })` so the browser's own time zone never leaks in.
- Copy (design skill section 8): plain words, no exclamation marks, no "seamlessly", no emoji. Example: "No members match 'xyz'." not "Oops! Nothing found!"
- **Four states on every screen** (design skill section 6): `Skeleton` shaped like the content while loading; `EmptyState` with one next step; an `Alert variant="destructive"` for errors with the API `message` (raw `code` secondary in `font-mono`); then the content.
- Responsive: staff screens target a laptop (1280px) and a tablet (the bar and desk); the public pages and the member area must work at 390px wide. Test with the browser's device toolbar.

### 2.5 Shared components to create (in `apps/web/src/components/club/`)

| Component | File | Props (short) | Used by |
| --- | --- | --- | --- |
| `Money` | `money.tsx` | `paise`, optional `className` | everywhere |
| `StatusBadge` | `status-badge.tsx` | `kind`, `value` (maps API enums to Badge variant and label) | members, bookings, orders, leads, invoices |
| `StatTile` | `stat-tile.tsx` | `label`, `value`, `hint?` | dashboard, desk home |
| `PageError` | `page-error.tsx` | `error`, `onRetry` | every page's error state |
| `MemberSearch` | `member-search.tsx` | `onSelect(member)` (debounced `GET /members/lookup`) | POS, bar, bookings, desk |
| `SlotGrid` | `slot-grid.tsx` | `data` (Availability), `onSelect(courtId, slot)`, `selected?` | courts, public play |
| `Cart` | `cart.tsx` | `lines`, `onChange`, `onCheckout` | shop, POS |
| `DateField` | `date-field.tsx` | `value`, `onChange`, `min?`, `max?` (wraps `Input type="date"`) | grids, reports |
| `PlanPicker` | `plan-picker.tsx` | `plans`, `value`, `onChange` | new member, convert lead |

---

## 3. Pages by route group

Legend for states: **L** loading (Skeleton), **E** empty (EmptyState), **X** error (Alert + retry). Every page below also has the normal content state. File path is `apps/web/src/app/<group>/<route>/page.tsx`. Hook files go in `apps/web/src/hooks/use-<module>.ts`.

### 3.1 `(marketing)`: public website (Scene 5)

| Route | Purpose | Components | Data | L | E | X |
| --- | --- | --- | --- | --- | --- | --- |
| `/` (exists; rewrite) | One claim, one proof, one next step. Headline "Book a court in seconds", the live "Free today" count as proof, buttons "See free slots" and "Join the club" | `site-header`, hero text, small free-slots strip, plan summary row | `GET /public/club`, `GET /public/availability?date=today` | strip skeleton | hide strip | hide strip, page still renders |
| `/plans` | Tier comparison with prices and entitlements | table: plan, monthly fee, court price, shop %, bar %, booking horizon; "Enquire" button per plan linking to `/contact?plan=<code>` | `GET /public/plans`, `GET /public/club` | table skeleton | EmptyState "Plans are being updated" | `PageError` |
| `/play` | Live free slots for the next 7 days and trial booking | `DateField` (today to +6), court-type `Tabs`, `SlotGrid` (read-only look; selecting opens a trial dialog), trial `Dialog` form (name, phone, email) | `GET /public/availability`, `POST /public/trial-bookings` | grid skeleton | EmptyState "Courts are closed on this day" | `PageError`; booking `409 SLOT_TAKEN` toast "That slot was just taken", grid refetches; polling every 10 s |
| `/shop` | Product browser and cart; checkout needs login | category `Tabs`, search `Input`, product grid (name, price, "Only 1 left" `Badge variant="warning"`, "Sold out" `Badge variant="destructive"`), `Cart` in a side `Dialog` or panel; "Sign in to order" if logged out; logged-in members see `yourPricePaise` and their discount | `GET /public/products` (guests) or `GET /products` (members), `POST /orders/quote`, `POST /orders/online` | grid skeleton | EmptyState "No products in this category" | `PageError`; checkout `409 OUT_OF_STOCK` highlights the line; polling every 10 s so "Sold out" appears live |
| `/contact` | Enquiry form | name, phone, email, interested plan `Select`, message; pre-selects plan from query string | `POST /public/enquiries`, `GET /public/plans` | form shows immediately | n/a | inline field errors; toast on failure; success replaces form with "Thanks, we'll be in touch within one working day." |
| `/share/[token]` | Read-only owner numbers from a share link | same chart components as `/reports` (reuse), no navigation chrome, "Shared view, expires <date>" line | `GET /public/reports/shared/:token` | skeleton | n/a | `404 SHARE_LINK_INVALID` shows EmptyState "This link has expired or was revoked" |

### 3.2 `(auth)`

| Route | Notes |
| --- | --- |
| `/login`, `/signup` | Exist. Only change: after login, route to `/dashboard`. Signup keeps the existing strict form (email, password, name). After first login a member without a profile sees a one-time `Dialog` on `/dashboard` asking phone and date of birth (`PUT /me/member`). |

### 3.3 `(app)`: member area (Scenes 1, 2, 3)

| Route | Purpose | Components | Data | L | E | X |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` (exists; extend) | Role-aware home (section 1) | `StatTile`, membership summary, next booking | per role | skeleton tiles | role-specific EmptyState | `PageError` |
| `/membership` | My plan and entitlements | `dl` with plan, status `StatusBadge`, expires on and days left; entitlements list (court, shop, bar %, bookings per day, horizon); "Ask the front desk to renew" text when `EXPIRING_SOON` or `EXPIRED` | `GET /me/member` | skeleton | EmptyState "You don't have a membership yet" with "See plans" link | `PageError` |
| `/courts` | **Slot grid**: choose a date, see every court by half-hour, book | `DateField`, court-type `Tabs`, `SlotGrid`, summary panel with chosen court, time, **price**, "usedToday of max" text, `Button` "Book court"; for staff: `MemberSearch` or "Walk-in" toggle with name and phone fields, optional "Take payment now" `Select` (Cash/Card/UPI); on booking success `toast.success` and refetch | `GET /courts/availability`, `POST /bookings`, `POST /bookings/social/join` | grid skeleton | EmptyState "Courts are closed on this day" | `409 SLOT_TAKEN` toast + refetch; `422 DAILY_LIMIT_REACHED` inline `Alert`; refetch every 10 s (`refetchInterval: 10000`) |
| `/bookings` | Members: "My bookings" with Upcoming/Past `Tabs`. Staff: all bookings for a date with filters | `Table`: when, court, who, price, `StatusBadge`, "Cancel" button opening a confirm `Dialog` that states whether it is a late cancel (within 2 hours: "No refund and it still counts toward your 2 a day") | `GET /me/bookings` or `GET /bookings`, `POST /bookings/:id/cancel`, `POST /bookings/:id/pay` | table skeleton | EmptyState "No bookings yet" + "Book a court" | `PageError` |
| `/orders` | Members: my orders with status; Staff: fulfilment board by status | members: `Table`; staff: `Tabs` by status (Placed, Ready, Out for delivery, Done) with order cards (the one place cards fit: each is a unit of work) and one action button per status | `GET /me/orders` or `GET /orders`, `PATCH /orders/:id/status`, `POST /orders/:id/cancel` | skeleton | EmptyState "No orders waiting" | `PageError` |
| `/notifications` | Full list with "Mark all read" | `Table`/list of notifications; unread rows have a `Badge` "New" | `GET /notifications`, `POST /notifications/read-all` | skeleton | EmptyState "You're all caught up" | `PageError` |

### 3.4 `(app)`: front desk (Scenes 1, 2, 3, 5)

| Route | Purpose | Components | Data | L | E | X |
| --- | --- | --- | --- | --- | --- | --- |
| `/members` | Find a member in seconds | search `Input` (debounced 250 ms, min 2 chars), status filter `Select`, plan filter `Select`, `Table` (code mono, name, phone, plan badge, expiry `StatusBadge`, days left), pagination; "New member" action | `GET /members` | table skeleton | EmptyState "No members match" | `PageError` |
| `/members/new` | Register a member | form: name, phone, email, date of birth, `PlanPicker` (shows price and entitlements), payment `Select`; submit "Register member"; success navigates to the profile and toasts the member code | `GET /plans`, `POST /members` | n/a | n/a | `422 JUNIOR_AGE_INVALID` as a field error on date of birth |
| `/members/[id]` | Profile: recognise and see history | header (name, code, plan badge, expiry badge), `Tabs`: Overview (`dl` of contact, entitlements), Timeline (list from `GET /members/:id/timeline`: check-ins, bookings, orders, tabs, invoices), Membership (renew, change plan, cancel as `Dialog`s); "Check in" button | `GET /members/:id`, `GET /members/:id/timeline`, `POST /members/:id/checkin`, `POST /members/:id/membership/*` | skeleton | Timeline EmptyState "No activity yet" | `404` EmptyState "Member not found" |
| `/pos` | Counter sale | left: product search + grid (quick add); right: `Cart` with `MemberSearch` (discount appears the moment a member is chosen, via `POST /orders/quote`), payment buttons Cash/Card/UPI; success toast with order number; `409 OUT_OF_STOCK` highlights the line | `GET /products`, `POST /orders/quote`, `POST /orders/pos` | grid skeleton | EmptyState "No products" | toast + inline |
| `/inventory` | Stock and low-stock | `Table` (SKU mono, name, category, stock `tabular`, reorder level, `Badge` "Low" warning or "Out" destructive), "Low stock only" `Switch`, row actions "Restock" (`Dialog`: qty, note) and for owner "Edit"/"Add product" dialog; movement history in a `Dialog` | `GET /products`, `GET /inventory/low-stock`, `POST /products/:id/restock`, `POST /products`, `PUT /products/:id`, `GET /products/:id/movements` | skeleton | EmptyState "No products yet" + "Add product" | `PageError` |
| `/crm` | Lead pipeline | top: `StatTile`s from `GET /crm/summary`; `Tabs` by status (New, Contacted, Quoted, Won, Lost) plus a "Follow up today" `Switch`; `Table` (name, phone, source, plan interest, next follow-up with overdue in `text-destructive`, assigned) | `GET /crm/leads`, `GET /crm/summary` | skeleton | EmptyState "No leads here" | `PageError` |
| `/crm/[id]` | Work a lead | `dl` of details; status `Select`; follow-up `DateField`; activity list + "Add note" form; quotes list + "Create quote" `Dialog` (plan, amount, valid until) + "Send quote"; primary action **"Convert to member"** `Dialog` (`PlanPicker`, payment, date of birth if Junior) | `GET /crm/leads/:id`, `PATCH /crm/leads/:id`, `POST …/activities`, `POST …/quotes`, `POST /crm/quotes/:id/send`, `POST …/convert` | skeleton | activities EmptyState "No activity yet" | `409 ALREADY_CONVERTED` shows link to the member |

### 3.5 `(app)`: bar (Scene 4)

| Route | Purpose | Components | Data | L | E | X |
| --- | --- | --- | --- | --- | --- | --- |
| `/bar` | Floor: tables and open tabs | grid of table tiles (name, status `Badge`, tab label, running total, minutes open); "Open tab" `Dialog` (table `Select`, `MemberSearch` or guest name); polling 5 s | `GET /bar/tables`, `POST /bar/tabs` | tile skeletons | EmptyState "No tables configured" (owner link to `/admin/club`) | `409 TABLE_OCCUPIED` toast |
| `/bar/tabs/[id]` | **Tab screen** | left: menu `Tabs` by category and item buttons showing price; right: items list with qty, line total, auto-discount line "Member discount 5%", `Button` "Send to kitchen" (disabled if no pending items), `Button` "Settle tab" opening a `Dialog` with Cash/Card/UPI buttons and the total; settled tabs show a read-only receipt | `GET /bar/tabs/:id`, `GET /bar/menu`, `POST …/items`, `DELETE …/items/:itemId`, `POST …/send`, `POST …/settle` | skeleton | EmptyState "Nothing ordered yet" | `409 ALREADY_SETTLED` toast and refetch |
| `/bar/kitchen` | Kitchen board (touch-friendly) | three columns: New, Preparing, Ready; ticket cards (table, tab label, items with qty and notes, "waiting 6 min" in `text-warning` after 10 minutes); one large button per card advancing status; polling 5 s | `GET /bar/tickets`, `PATCH /bar/tickets/:id/status` | column skeletons | EmptyState "No tickets" | `PageError` |
| `/bar/earnings` | Daily bar earnings and closing report | `DateField`, `StatTile`s (total, tabs, average), by-payment-mode list, by-shift `Table`, top items `Table`; "Print" button | `GET /bar/earnings` | skeleton | EmptyState "No bar sales on this day" | `PageError` |
| `/shifts` | Roster and clock in/out | week `Table` (employee by day with shift chips); "My shift" panel with "Clock in"/"Clock out"; owner "Add shift" `Dialog` | `GET /shifts`, `POST /shifts`, `POST /shifts/:id/clock-in`, `…/clock-out`, `GET /me/shift/current` | skeleton | EmptyState "No shifts scheduled" | `PageError` |

### 3.6 `(app)`: finance, HR, owner (Scene 6)

| Route | Purpose | Components | Data | L | E | X |
| --- | --- | --- | --- | --- | --- | --- |
| `/reports` | **Owner dashboard** | `PageHeader` actions: "Export CSV" (plain link) and "Share" (`Dialog` showing the generated link once, with a copy button); range `Tabs` Today / This week / This month; row of `StatTile`s (revenue with change vs previous, bookings, utilisation %, new members); **revenue by source** bar chart; **revenue by payment mode** bar or donut; **revenue trend** line/area chart; "What we owe" `dl` (tax payable, payroll due, unpaid invoices with overdue count); alerts list linking to Inventory, Members (expiring), CRM, HR. Auto-refetch every 10 s | `GET /reports/dashboard`, `POST /reports/shares`, `GET /reports/export.csv` | tile + chart skeletons | EmptyState "No sales in this period" | `PageError`; keep last data visible if a refetch fails (TanStack Query default) |
| `/invoices` | Invoice list | status `Tabs` (All, Draft, Sent, Paid, Overdue), `Table` (number mono, bill to, issue date, due date, total, balance, `StatusBadge`), "New invoice" | `GET /invoices` | skeleton | EmptyState "No invoices yet" | `PageError` |
| `/invoices/new` | Create invoice for a business client or member | bill-to picker, dynamic line items (`useFieldArray`), live total, notes; "Save draft" | `GET /business-clients`, `POST /business-clients`, `POST /invoices` | n/a | n/a | field errors |
| `/invoices/[id]` | View, send, take payment, print | `dl`, lines `Table`, payments list, actions "Send", "Record payment" (`Dialog`), "Print" (`window.print()`, with `print:` Tailwind variants hiding the shell) | `GET /invoices/:id`, `POST …/send`, `POST …/pay`, `POST …/void` | skeleton | n/a | `404` EmptyState |
| `/hr` | Employees, leave, payroll | `Tabs`: Employees (`Table`, add/edit `Dialog`), Leave (pending first; Approve/Reject buttons for owner; "Request leave" `Dialog` for staff), Payroll (month `Select`, total and by-department list) | `GET /hr/employees`, `GET /hr/leave`, `POST /hr/leave/:id/decision`, `GET/POST /me/leave`, `GET /hr/payroll-summary` | skeleton | EmptyState per tab | `409 LEAVE_OVERLAP` toast |
| `/admin/club` | Plans, courts, social windows, bar menu | `Tabs` strip like the existing admin layout: Plans (`Table` with inline edit `Dialog` for fee and %), Courts (list + blocks: "Block court" `Dialog`), Social play (weekday, times, switch), Bar menu (`Table` with availability `Switch`) | `GET/PUT /plans`, `GET /courts`, `POST/DELETE /courts/blocks`, `GET/PUT /social-windows`, `GET/POST/PUT /bar/menu` | skeleton | EmptyState | `PageError` |
| `/admin/demo` **(ADDITION, hidden in production)** | Concurrency proof for the demo | form: court, time, attempts; "Run test" button; result panel "20 attempts: 1 confirmed, 19 slot taken" | `POST /demo/booking-race` | spinner text on button | n/a | `404` hides the page |

---

## 4. Mock-first workflow (so you are never blocked)

1. For each module, create `apps/web/src/mocks/<module>.json` copying the examples from `API_CONTRACT.md` (copy the JSON exactly; add 5 to 10 realistic rows for lists).
2. In `apps/web/src/lib/api-client.ts` follow the existing `api.<module>.<method>` pattern. Inside each method, return the mock when `process.env.NEXT_PUBLIC_USE_MOCKS === 'true'`:

   ```ts
   import plansMock from '@/mocks/plans.json';
   const mock = <T,>(data: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(data), ms));

   plans: {
     list: () => (USE_MOCKS ? mock(plansMock as Plan[]) : fetchApi<Plan[]>('/api/v1/plans')),
   },
   ```
3. Build the page with a hook (`useQuery`) calling `api.plans.list()`. The page does not know whether data is mock or real.
4. When Mihir says "endpoint ready" in the shared channel: set `NEXT_PUBLIC_USE_MOCKS=false` locally (or remove that module's mock branch), fix any shape difference with Mihir (the contract wins), and re-test the four states.
5. Types: import from `@packages/validation` once Mihir has pushed the schema; until then define the TypeScript type next to the mock with a `// TODO: replace with @packages/validation` comment.

Mock the error states too: add a `?mock=error` toggle in the hook (return a rejected promise) so you can see your error `Alert` without breaking the API.

---

## 5. Suggested build order (easiest to hardest)

| # | Page / piece | Why this order |
| --- | --- | --- |
| 1 | `formatMoney`, `formatDateTime`, `Money`, `StatusBadge`, `PageError` | Tiny, used everywhere |
| 2 | Sidebar items + role awareness | Warm-up inside an existing file |
| 3 | `/plans` (public) | One table of static-looking data |
| 4 | `/contact` (public) | First form |
| 5 | `/` landing rewrite | Layout and copy only |
| 6 | `/members` list | Table, search, pagination (reused pattern) |
| 7 | `/members/new` | Form with a picker |
| 8 | `/members/[id]` | Tabs, dialogs, timeline |
| 9 | `/inventory` | Table plus dialogs |
| 10 | `/shop` + `Cart` | State handling, quote calls |
| 11 | `/orders` | Status board |
| 12 | `/crm`, `/crm/[id]` | Pipeline and detail |
| 13 | `/invoices*`, `/hr` | More tables, `useFieldArray` |
| 14 | Topbar notification bell, `/notifications` | Polling pattern |
| 15 | `/bookings` and `/membership` | Member self-service |
| 16 | **`/courts` + `SlotGrid`** | The hardest layout; do after you are comfortable |
| 17 | `/play` (public slots and trial) | Reuses `SlotGrid` |
| 18 | `/pos` | Cart plus member discount |
| 19 | `/bar`, `/bar/tabs/[id]`, `/bar/kitchen`, `/bar/earnings` | Most interactive |
| 20 | **`/reports` charts** and `/share/[token]` | Charts library; do last, polish for the demo |

**Cut line:** if time runs out, skip `/admin/demo` styling (a plain form is fine), `/shifts` roster polish, `/invoices/new` line-item niceties, and the donut chart (use bars).
