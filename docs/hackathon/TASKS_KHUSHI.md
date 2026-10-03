# TASKS_KHUSHI.md

> Owner: Khushi (frontend). Written so you can follow it without asking anyone, and so you are **never blocked**: every page is built first against **mock JSON**, then switched to Mihir's real API.
> Companion documents: `UI_SPEC.md` (what every page contains), `API_CONTRACT.md` (the exact JSON), `TECH_STACK.md` (setup and libraries).
> Tasks are ordered by **priority tier**, not by time. Tier 1 and Tier 2 together cover the demo. If you fall behind, use the cut line in section 6. Doing fewer pages well beats many pages half-done.

---

## 0. Ground rules (read once)

1. **Work in the right folder.** All your code is in `apps/web/src/`. You almost never touch `apps/api` or `packages/*`.
2. **Copy patterns, do not invent.** Find a similar existing file and copy its structure: `app/(app)/dashboard/page.tsx` (a page), `components/app-shell/sidebar.tsx` (navigation), `hooks/use-health.ts` (a data hook), `lib/api-client.ts` (API calls), `components/ui/*` (building blocks).
3. **Colours come from tokens**, never from literal Tailwind colours. Write `text-success`, `bg-muted`, `text-destructive`. Do not write `text-green-500`. No emoji. Icons only in the sidebar and icon-only buttons.
4. **Every page handles four states:** loading (`Skeleton`), empty (`EmptyState`), error (`Alert`), content.
5. **Before every push:** `pnpm lint` and `pnpm typecheck` must both finish with zero errors and zero warnings.
6. **Commit small and often** (after each working step), using `feat(members): add members table`.
7. **If something in the contract looks wrong, tell Mihir** instead of working around it. He will fix the contract file first.

### The Page Recipe (every page follows these 8 steps)

We will reuse this recipe in every task. Learn it with the first task, then it gets fast.

1. **Mock data.** Copy the JSON example from `API_CONTRACT.md` into `apps/web/src/mocks/<module>.json` (make a list of 5 to 10 realistic rows).
2. **API method.** Add a method in `apps/web/src/lib/api-client.ts` inside `export const api = { ... }`. When `USE_MOCKS` is true it returns the mock (task K-05 explains this once).
3. **Hook.** Create `apps/web/src/hooks/use-<module>.ts` with a `useQuery` call (copy `use-health.ts`).
4. **Page file.** Create `apps/web/src/app/(app)/<route>/page.tsx` starting with `'use client';`.
5. **Header.** Start the page with one `<PageHeader title="…" description="…" actions={…} />`.
6. **Four states.** `isLoading` → `Skeleton`; `error` → `Alert variant="destructive"` with `error.message`; empty list → `EmptyState`; otherwise the content.
7. **Look.** Use `Table`, `Badge`, `Card`, `Dialog` etc. from `@/components/ui/*` and tokens from `UI_SPEC.md` section 2. Check light **and** dark mode and a narrow window.
8. **Switch to real.** When Mihir says the endpoint is ready, set `NEXT_PUBLIC_USE_MOCKS=false` in your `.env` (restart `pnpm dev:web`) and retest.

**Worked example: the Members list in 25 lines** (use it as your template):

```tsx
// apps/web/src/hooks/use-members.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useMembers(params: { q?: string; page?: number }) {
  return useQuery({
    queryKey: ['members', params],            // changes -> TanStack refetches
    queryFn: () => api.members.list(params),
  });
}
```

```tsx
// apps/web/src/app/(app)/members/page.tsx
'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMembers } from '@/hooks/use-members';

export default function MembersPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useMembers({ q });

  return (
    <>
      <PageHeader title="Members" description="Find a member by name, phone or code." />
      {isLoading && <Skeleton className="h-64" />}
      {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
      {data && data.data.length === 0 && <EmptyState title="No members match" />}
      {data && data.data.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.data.map((m) => (
              <TableRow key={m.id}><TableCell className="font-mono text-xs">{m.memberCode}</TableCell><TableCell>{m.fullName}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
```

### Universal Definition of Done (applies to every page task, plus the specific points listed)

- [ ] Loads at its URL with no console errors (open the browser's developer tools, Console tab).
- [ ] Loading, empty and error states each seen on screen at least once.
- [ ] Works in light **and** dark mode (use the theme toggle).
- [ ] Looks right at a narrow width (about 390px) for public and member pages; at laptop width for staff pages.
- [ ] No literal colours, no emoji, one `PageHeader`, sentence-case buttons that start with a verb.
- [ ] `pnpm lint` and `pnpm typecheck` pass.
- [ ] Committed on your branch and pushed.

### Useful official docs (bookmark these)

| Topic | Link |
| --- | --- |
| Next.js pages and layouts | https://nextjs.org/docs/app/getting-started/layouts-and-pages |
| Next.js client components | https://nextjs.org/docs/app/getting-started/server-and-client-components |
| TanStack Query: queries | https://tanstack.com/query/latest/docs/framework/react/guides/queries |
| TanStack Query: mutations | https://tanstack.com/query/latest/docs/framework/react/guides/mutations |
| TanStack Query: refresh after a change | https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation |
| React Hook Form | https://react-hook-form.com/get-started |
| Zod | https://zod.dev |
| shadcn/ui components (we use the ones in `components/ui`) | https://ui.shadcn.com/docs/components |
| Tailwind CSS | https://tailwindcss.com/docs |
| Recharts (charts) | https://recharts.org/en-US/ |
| React basics (useState, useEffect) | https://react.dev/learn |
| Number and date formatting | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat |
| Git basics | https://git-scm.com/book/en/v2/Git-Basics-Getting-a-Git-Repository |

---

## 1. Phase A: Setup and confidence

### K-01: Get the project running · Tier 1 · depends on: nothing

- **Build:** nothing yet; get the app running and make one tiny edit.
- **Steps:** follow the "First-day setup checklist" in `TECH_STACK.md` section 4. Then create your branch: `git checkout -b khushi/setup`.
- **Docs:** `README.md` quick start in the repo.
- **Test:** `http://localhost:3000` loads; logging in as root shows the dashboard.
- **Done when:** you changed one line of text, saw it hot-reload, and reverted it.

### K-02: Tour the code · Tier 1 · depends on: K-01

- **Build:** nothing; read.
- **Steps:** open and skim, in this order: `apps/web/src/app/(app)/layout.tsx` (the signed-in shell), `components/app-shell/sidebar.tsx`, `components/app-shell/page-header.tsx`, `components/app-shell/empty-state.tsx`, `app/(app)/dashboard/page.tsx`, `hooks/use-health.ts`, `lib/api-client.ts` (just look at how `api.profile.get` is written), `components/ui/badge.tsx`, `components/ui/table.tsx`, and `skills/design/SKILL.md` sections 2 to 6.
- **Test yourself:** can you answer "where would I add a new sidebar link?" and "where is the `Skeleton` component?"
- **Done when:** you can answer both without searching.

### K-03: Formatting helpers and small shared components · Tier 1 · depends on: K-02

- **Build:** helpers every page will reuse.
- **Where:** `apps/web/src/lib/format.ts`, `apps/web/src/components/club/money.tsx`, `status-badge.tsx`, `page-error.tsx`.
- **Steps:**
  1. In `lib/format.ts` write `formatMoney(paise: number): string` using `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100)` (use `maximumFractionDigits: 0` when paise is a multiple of 100). Write `formatDateTime(iso: string)` and `formatDate(iso: string)` using `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ... })`.
  2. `Money`: `export function Money({ paise }: { paise: number }) { return <span className="tabular">{formatMoney(paise)}</span>; }`.
  3. `StatusBadge`: props `kind` (`'booking' | 'membership' | 'order' | 'lead' | 'invoice' | 'stock'`) and `value` (string). Inside, a lookup object maps each value to a `Badge variant` (`success`, `warning`, `destructive`, `secondary`, `outline`) and a readable label (e.g. `EXPIRING_SOON` → "Expiring soon" in warning). See the table in `UI_SPEC.md` section 2.1.
  4. `PageError`: props `error: Error`, `onRetry?: () => void`; renders an `Alert variant="destructive"` with a plain sentence, the message in `font-mono text-xs`, and a "Try again" `Button`.
- **Mock JSON:** none.
- **Docs:** Intl.NumberFormat (link above).
- **Test:** create `apps/web/src/lib/format.test.ts` with Vitest: `expect(formatMoney(42000)).toBe('₹420')` and a rupees-with-paise case. Run `pnpm --filter @app/web test`. (Copy the style of `lib/errors.test.ts`.)
- **Done when:** the test passes and the three components compile (`pnpm typecheck`).

### K-04: Role-aware sidebar · Tier 1 · depends on: K-02

- **Build:** the navigation from `UI_SPEC.md` section 1.
- **Where:** edit `apps/web/src/components/app-shell/sidebar.tsx`.
- **Steps:**
  1. Import the needed icons from `lucide-react` (names are in the UI_SPEC table; if one does not exist in v0.475 pick a similar one from https://lucide.dev/icons/).
  2. Extend the `sections` array. For each new item set `show` using `hasPermission('…')` from `useAuth()`, exactly like `canAccessAdmin` is done today. For member-only items use `hasPermission('bookings:read:self')`.
  3. Pages do not exist yet, so the links will 404; that is fine for now.
- **Mock JSON:** none. To see items before Mihir's roles exist, log in as root (root sees everything).
- **Test:** log in as root: all items show. (Later, log in as the seeded desk user: only desk items show.)
- **Done when:** sections and items match the table; the active item highlights; lint and typecheck pass.

---

## 2. Phase B: Mock layer and public pages

### K-05: Set up the mock layer · Tier 1 · depends on: K-03

- **Build:** the switch that lets you work without the API.
- **Where:** `apps/web/src/lib/api-client.ts`, `apps/web/src/mocks/`, `.env`.
- **Steps:**
  1. Create the folder `apps/web/src/mocks/`.
  2. Near the top of `api-client.ts` add:
     ```ts
     export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';
     export const mock = <T,>(data: T, ms = 300) =>
       new Promise<T>((resolve) => setTimeout(() => resolve(data), ms));
     ```
  3. Add `NEXT_PUBLIC_USE_MOCKS=true` to your own `.env` (never commit `.env`) and restart `pnpm dev:web`.
  4. Create `mocks/plans.json` by copying the Plan example in `API_CONTRACT.md` section 1 into an array of three plans (Gold, Silver, Junior) with the numbers from `PROJECT_OVERVIEW.md` section 2.3.
  5. Add `plans: { list: () => USE_MOCKS ? mock(plansMock as Plan[]) : fetchApi<Plan[]>('/api/v1/plans') }` to the `api` object (import `plansMock from '@/mocks/plans.json'`). Until Mihir publishes `@packages/validation` types (his task M-04), define `type Plan = …` at the top of the file with a `// TODO: replace with @packages/validation` comment.
- **Docs:** none new.
- **Test:** a temporary `console.log` in a hook call shows the plans after about 300 ms (remove the log afterwards).
- **Done when:** `api.plans.list()` resolves to your mock.

### K-06: Plans page `/plans` · Tier 1 · depends on: K-05, K-03

- **Build:** public page comparing the three tiers (Scene 5).
- **Where:** `apps/web/src/app/(marketing)/plans/page.tsx`, `hooks/use-plans.ts`.
- **Steps:** follow the Page Recipe. This page is public, so it lives under `(marketing)` (it gets the public header and footer). Use `GET /public/plans` in the real API (add `api.public.plans()` or reuse `plans.list` with a `public` flag; ask Mihir if unsure). Show a `Table` with columns: Plan, Monthly fee, Court price, Shop discount, Bar discount, Book ahead. Compute court price with `formatMoney(…)` from the court type base rate in `public/club` (mock: base 600 rupees); show "Free play" when `courtDiscountPct === 100`. Add an "Enquire" `Button` linking to `/contact?plan=GOLD`. Marketing pages are **not** inside the signed-in shell, so skip `PageHeader`; use a simple `h1` styled `text-2xl font-semibold tracking-tight` plus one sentence, like the existing `(marketing)/page.tsx`.
- **Mock JSON:** `mocks/plans.json`, `mocks/club.json` (copy the `/public/club` response from the contract).
- **Docs:** shadcn Table https://ui.shadcn.com/docs/components/table
- **Test:** the table shows three rows; narrow the window to 390px and check it scrolls instead of breaking (wrap the table in `div className="overflow-x-auto"`); toggle dark mode.
- **Done when:** the universal checklist is ticked.

### K-07: Enquiry form `/contact` · Tier 1 · depends on: K-05

- **Build:** the form that creates a lead (Scene 5).
- **Where:** `apps/web/src/app/(marketing)/contact/page.tsx`, `hooks/use-enquiry.ts`.
- **Steps:**
  1. Fields: name, phone, email, interested plan (`Select` from `components/ui/select`), message. At least phone or email is required.
  2. Build with `react-hook-form` and a Zod schema: `const Schema = z.object({ name: z.string().min(1, 'Enter your name'), phone: z.string().optional(), email: z.string().email().optional().or(z.literal('')), message: z.string().min(5, 'Tell us a little more') }).refine(v => v.phone || v.email, { message: 'Add a phone number or an email', path: ['phone'] })` and `useForm({ resolver: zodResolver(Schema) })`. Look at `app/(auth)/signup/page.tsx` for the existing form style and copy it.
  3. Submit with `useMutation({ mutationFn: api.public.createEnquiry })` (mock returns the success JSON after 500 ms).
  4. On success replace the form with "Thanks, we'll be in touch within one working day."; on error show `toast.error(error.message)`.
  5. Read `?plan=GOLD` from `useSearchParams()` to pre-select the plan.
- **Mock JSON:** the `POST /public/enquiries` response (`mocks/enquiry.json`).
- **Docs:** React Hook Form get started (link above); TanStack mutations (link above).
- **Test:** submit empty (inline errors appear), submit valid (success message), set the mock to fail once (throw inside `mock`) to see the error toast.
- **Done when:** universal checklist ticked; button reads "Send enquiry" and is disabled while submitting.

---

## 3. Phase C: Tables, forms and detail pages

### K-08: Members list `/members` · Tier 1 · depends on: K-05, K-03

- **Build:** the front desk's most-used page (Scene 1).
- **Where:** `app/(app)/members/page.tsx`, `hooks/use-members.ts`, `hooks/use-debounce.ts`.
- **Steps:** start from the worked example in section 0. Add: a search `Input` with `useDebounce(q, 250)` and only search when the text has at least 2 characters; plan `Select` filter (All, Gold, Silver, Junior); columns Code (mono), Name, Phone, Plan (tier badge: Gold `default`, Silver `secondary`, Junior `outline`), Expiry (`StatusBadge kind="membership"` using `membership.expiryState`) and "Days left"; clicking a row goes to `/members/<id>` (`Link`); a "New member" button in `PageHeader actions` linking to `/members/new`; simple Previous/Next pagination using `meta.hasPrevPage/hasNextPage`.
- **Mock JSON:** `mocks/members.json`: 8 members in the paginated shape `{ data: [...], meta: {...} }` (use the Member example), a mix of ACTIVE, EXPIRING_SOON and EXPIRED, and the three plans.
- **Docs:** TanStack queries (link above); shadcn Select https://ui.shadcn.com/docs/components/select
- **Test:** type "aar" and see the list filter (mock: filter in the mock function with `Array.filter` so the search feels real); clear the box and see everything; search nonsense to see the empty state.
- **Done when:** universal checklist ticked.

### K-09: New member form `/members/new` · Tier 1 · depends on: K-08

- **Build:** register a member at the desk.
- **Where:** `app/(app)/members/new/page.tsx`, `components/club/plan-picker.tsx`, mutation in `hooks/use-members.ts`.
- **Steps:** a form with name, phone, email, date of birth (`Input type="date"`), `PlanPicker` (three selectable rows, each showing plan name, price and the entitlements in one line; selected row has `border-primary`; build it with `button` elements and `aria-pressed`), payment mode (`Select`: Cash, Card, UPI). Zod schema: name and phone required. If the Junior plan is picked and the date of birth makes the person 18 or older, show an inline error (you can compute age in the browser as a convenience; the server also checks). Submit "Register member"; on success `toast.success('Member CC-000123 registered')` using the returned `memberCode`, then `router.push('/members/' + id)` (`useRouter` from `next/navigation`).
- **Mock JSON:** the `POST /members` response example from `API_CONTRACT.md` section 4.2 in `mocks/member-created.json`.
- **Docs:** React Hook Form; `useRouter` https://nextjs.org/docs/app/api-reference/functions/use-router
- **Test:** submit incomplete (errors), submit valid (toast and redirect), choose Junior with an adult date of birth (error).
- **Done when:** universal checklist ticked.

### K-10: Member profile `/members/[id]` · Tier 1 · depends on: K-08

- **Build:** recognise a member and see their history (Scene 1).
- **Where:** `app/(app)/members/[id]/page.tsx` (read the id with `useParams()`), `hooks/use-members.ts`.
- **Steps:**
  1. Header: `PageHeader title={member.fullName}` with description showing member code and a "Check in" `Button` (calls `POST /members/:id/checkin`, success toast "Checked in").
  2. Below, a row with plan badge and expiry `StatusBadge`, then `Tabs` (`components/ui/tabs`): **Overview** (a `dl` like the dashboard's `Field`: phone, email, date of birth, plan, starts on, ends on, days left, entitlements listed as plain lines), **Timeline** (a list of events from `/members/:id/timeline`, each row: date, title, detail, money if present), **Membership** (buttons "Renew" and, later, "Change plan"; opens a `Dialog` with a payment `Select` and a "Confirm renewal" button).
  3. If `expiryState` is `EXPIRING_SOON` or `EXPIRED`, show an `Alert` (variant `default` with `text-warning`, or `destructive` for expired) at the top: "Membership expires in 3 days."
- **Mock JSON:** `mocks/member-detail.json` (Member), `mocks/member-timeline.json` (6 events of mixed types).
- **Docs:** shadcn Tabs https://ui.shadcn.com/docs/components/tabs ; Dialog https://ui.shadcn.com/docs/components/dialog
- **Test:** switch tabs; open and close the dialog with the keyboard (Escape); view an expired member; force a 404 in the mock to see "Member not found".
- **Done when:** universal checklist ticked.

### K-11: Inventory `/inventory` · Tier 2 · depends on: K-08

- **Build:** stock and low-stock view (Scene 3).
- **Where:** `app/(app)/inventory/page.tsx`, `hooks/use-products.ts`.
- **Steps:** `Table` with SKU (mono), Name, Category, Stock (right-aligned, `tabular`), Reorder level, status (`Badge`: "Out of stock" destructive when 0, "Low" warning when `lowStock`, nothing otherwise); a "Low stock only" `Switch` filter; a "Restock" `Button size="sm" variant="outline"` per row opening a `Dialog` (quantity `Input type="number"`, note) that calls `POST /products/:id/restock` and then refreshes the list with `queryClient.invalidateQueries({ queryKey: ['products'] })` (read the invalidation doc). Add "Add product" later if time permits.
- **Mock JSON:** `mocks/products.json` (12 products; 3 low, 1 out of stock, one with stock 1).
- **Docs:** shadcn Switch https://ui.shadcn.com/docs/components/switch ; TanStack invalidation (link above).
- **Test:** toggle low stock; restock a product and see its number change (the mock function can mutate its in-memory array).
- **Done when:** universal checklist ticked.

### K-12: Shop and cart `/shop` · Tier 1 · depends on: K-11

- **Build:** the public product browser with a cart (Scene 3).
- **Where:** `app/(marketing)/shop/page.tsx`, `components/club/cart.tsx`, `hooks/use-cart.ts` (cart state in `useState`; save to `localStorage` if time allows).
- **Steps:** category `Tabs` (All, Rackets, Balls, Shoes, Accessories, Apparel), search `Input`, a product grid (each product: name, price, "Add" button); stock badge "Only 1 left" (warning) or "Sold out" (destructive, button disabled); a cart panel (`Dialog` or right-hand column) listing lines with quantity buttons and total from `POST /orders/quote`; a "Sign in to order" `Button` for logged-out users and "Place order" for members (choose Pickup or Delivery with a `Select`; delivery needs an address `Input`); members see `yourPricePaise` with a small "Member price" label. Refetch products every 10 seconds (`refetchInterval: 10000`) so "Sold out" appears live.
- **Mock JSON:** reuse `products.json`; `mocks/quote.json`; `mocks/order-created.json`.
- **Docs:** shadcn Tabs/Dialog (links above); `refetchInterval` https://tanstack.com/query/latest/docs/framework/react/reference/useQuery
- **Test:** add items, change quantity, remove, open cart; edit the mock stock to 0 and watch "Sold out" appear within 10 seconds.
- **Done when:** universal checklist ticked, and the page works at 390px wide.

### K-13: My bookings `/bookings` and My membership `/membership` · Tier 2 · depends on: K-10

- **Build:** the member's own area (Scenes 1 and 2).
- **Where:** `app/(app)/bookings/page.tsx`, `app/(app)/membership/page.tsx`, `hooks/use-bookings.ts`.
- **Steps:** Bookings: `Tabs` Upcoming/Past; `Table` (When, Court, Price, `StatusBadge kind="booking"`, "Cancel" `Button size="sm" variant="outline"`). The cancel `Dialog` explains the rule in plain words: "Free to cancel until 2 hours before. After that there is no refund and it still counts toward your 2 bookings a day." (Use the `late` hint: calculate `new Date(startsAt) - Date.now() < 2*60*60*1000`.) Staff variant: if `hasPermission('bookings:read')` show all bookings for a chosen date (`DateField`). Membership page: `dl` with plan, status, ends on, days left, then entitlements; `EmptyState` with a "See plans" link if none.
- **Mock JSON:** `mocks/bookings.json` (the Booking example, 6 rows), `mocks/me-member.json`.
- **Docs:** previous links.
- **Test:** cancel an upcoming booking in the mock and see the row become Cancelled.
- **Done when:** universal checklist ticked.

---

## 4. Phase D: The hard pages

### K-14: Booking calendar `/courts` with the slot grid · Tier 1 · depends on: K-13 · pair with Mihir at the start

- **Build:** the most important screen in the product (Scene 2).
- **Where:** `components/club/slot-grid.tsx`, `components/club/date-field.tsx`, `app/(app)/courts/page.tsx`, `hooks/use-availability.ts`.
- **Steps:**
  1. `DateField`: an `Input type="date"` with `min` = today and `max` = today + 14 days.
  2. `use-availability.ts`: `useQuery({ queryKey: ['availability', date, courtTypeId], queryFn: () => api.courts.availability({ date, courtTypeId }), refetchInterval: 10000 })`.
  3. `SlotGrid` props: `data`, `selected`, `onSelect(courtId, slot)`. Layout with CSS grid: one **column per court** and **one row per half-hour start** (collect the unique `startsAt` values across courts, sort them). Use `style={{ gridTemplateColumns: \`80px repeat(${courts.length}, minmax(0, 1fr))\` }}` on a `div className="grid gap-1"`. Row label: the time (`formatTime`). Each cell is a `button` styled by `status` using the class table in `UI_SPEC.md` section 2.2; disabled when not `FREE`/`SOCIAL_OPEN`.
  4. Page: court-type `Tabs` (All, Tennis, Padel, Badminton, Cricket Nets) that set `courtTypeId`; the grid; a summary panel appearing when a slot is selected: court, time range, **price** (`Money`), the text "You've used 1 of 2 bookings today" from `limits`, and a "Book court" `Button` calling `useMutation(api.bookings.create)`. After success: `toast.success('Booked Tennis Court 1 at 6:00 pm')`, clear the selection and `invalidateQueries(['availability'])`.
  5. Errors: `SLOT_TAKEN` → `toast.error('That slot was just taken')` and refetch; `DAILY_LIMIT_REACHED` → inline `Alert` above the grid.
  6. Staff version (`hasPermission('bookings:create')`): extra controls in the summary panel: a toggle "Member / Walk-in"; for Member use `MemberSearch` (task K-16 builds it; until then a plain `Input` for a member id); for Walk-in a name and phone input; a "Take payment now" `Select`.
  7. Social mode: cells with `SOCIAL_OPEN` say "3 of 8 left" and the button reads "Join session" calling `api.bookings.joinSocial`.
- **Mock JSON:** `mocks/availability.json`: copy the example from `API_CONTRACT.md` 5.1 and extend it to 4 courts and 12 slots each, with a mix of statuses. Make a second file `availability-friday.json` with `mode: "SOCIAL"` courts to test social cells.
- **Docs:** Tailwind grid template columns https://tailwindcss.com/docs/grid-template-columns ; TanStack mutations (link above).
- **Test:** select a free slot (highlights), select a booked slot (nothing happens), change date, switch tab, book (toast and the cell turns booked after the mock updates), view the Friday file, resize to a narrow width (the grid scrolls horizontally inside `overflow-x-auto`).
- **Done when:** universal checklist ticked and the grid refreshes every 10 seconds (watch the network tab).

### K-15: Public live slots `/play` · Tier 1 · depends on: K-14

- **Build:** the website's "what is free this week" and trial booking (Scene 5).
- **Where:** `app/(marketing)/play/page.tsx`, a `TrialDialog` inside the same file.
- **Steps:** reuse `SlotGrid` read-only (public data has no holder names). Selecting a free slot opens a `Dialog` with name, phone and email (React Hook Form + Zod) and a "Book trial" button calling `api.public.createTrialBooking`. Success: replace the dialog body with "Trial booked. Pay at the club on arrival." and the time. `SLOT_TAKEN`: toast and refetch. `TRIAL_ALREADY_USED`: field error on phone.
- **Mock JSON:** `availability.json` (reuse), `mocks/trial-created.json`.
- **Docs:** previous links.
- **Test:** full flow in mock; narrow width.
- **Done when:** universal checklist ticked.

### K-16: Counter sale `/pos` and `MemberSearch` · Tier 1 · depends on: K-12

- **Build:** the front desk till (Scene 3).
- **Where:** `components/club/member-search.tsx`, `app/(app)/pos/page.tsx`.
- **Steps:** `MemberSearch`: an `Input` with `useDebounce`; results in a small list under it from `api.members.lookup(q)`; selecting calls `onSelect(member)` and shows a chip "Aarav Mehta · Silver · shop 8%" with a clear button. POS page: left = product search and a grid of product buttons (tap to add); right = `Cart` with `MemberSearch` on top; whenever lines or member change call `api.orders.quote` and show subtotal, discount, total; payment buttons Cash / Card / UPI call `api.orders.createPos`; on success `toast.success('Order ORD-000045 paid')` and clear the cart; `OUT_OF_STOCK` highlights the failing line with `text-destructive` and a message from `details`.
- **Mock JSON:** `members.json` (lookup filters it), `products.json`, `quote.json`, `order-pos.json`.
- **Docs:** previous links.
- **Test:** add items, pick a member (discount appears), pay (cart clears); trigger out-of-stock by mocking an error.
- **Done when:** universal checklist ticked.

### K-17: Bar floor and tab screen `/bar`, `/bar/tabs/[id]` · Tier 1 · depends on: K-16 · pair with Mihir at the start

- **Build:** the bar POS (Scene 4).
- **Where:** `app/(app)/bar/page.tsx`, `app/(app)/bar/tabs/[id]/page.tsx`, `hooks/use-bar.ts`.
- **Steps:**
  1. **Floor:** a responsive grid (`grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3`) of table tiles: name, status `Badge` (Free outline / Occupied warning), tab label and running total when occupied, minutes open. Tap a free table to open the "Open tab" `Dialog` (`MemberSearch` or guest name `Input`); tap an occupied table to go to its tab. Refetch every 5 seconds.
  2. **Tab screen:** two columns. Left: category `Tabs` (Drinks, Food, Snacks) and item buttons showing name and price; tapping calls `api.bar.addItem` (qty 1) and refreshes. Right: the items list (name, qty with minus/plus, line total, small `text-muted-foreground` line "Member discount 5%" when `discountPct > 0`), totals (subtotal, discount, total), `Button` "Send to kitchen" (disabled when no `PENDING` items; items that are `SENT` show a "Sent" badge), `Button` "Settle tab" opening a `Dialog` with three large buttons Cash / Card / UPI and the total.
  3. Settled tabs render read-only with a "Settled" badge and the receipt summary.
  4. Errors: `ALREADY_SETTLED` toast and refresh.
- **Mock JSON:** `mocks/bar-tables.json`, `mocks/bar-menu.json` (15 items), `mocks/bar-tab.json` (the Tab example), `mocks/bar-settle.json`. Make the mock functions mutate an in-memory tab so adding items updates totals.
- **Docs:** shadcn Dialog/Tabs/Badge (links above).
- **Test:** open a tab, add items, send to kitchen, settle by UPI, then see the table become free.
- **Done when:** universal checklist ticked and it is usable on a tablet-width window (768px).

### K-18: Kitchen board `/bar/kitchen` · Tier 2 · depends on: K-17

- **Build:** the screen the kitchen looks at (Scene 4).
- **Where:** `app/(app)/bar/kitchen/page.tsx`.
- **Steps:** three columns New / Preparing / Ready (`grid md:grid-cols-3 gap-4`). Each ticket is a card (this is a case where a card fits: one unit of work) showing table name, tab label, items with quantities and notes, and "waiting 6 min". After 10 minutes the waiting text uses `text-warning`. One big `Button` per card advances the status (New → "Start", Preparing → "Mark ready", Ready → "Mark served"; served tickets disappear). Refetch every 5 seconds. Empty column: small muted text "Nothing here".
- **Mock JSON:** `mocks/bar-tickets.json` (6 tickets across statuses).
- **Docs:** TanStack mutations (link above).
- **Test:** advance a ticket and see it move columns.
- **Done when:** universal checklist ticked.

### K-19: Owner dashboard `/reports` with charts · Tier 1 · depends on: K-03 · pair with Mihir at the start

- **Build:** the headline screen (Scene 6).
- **Where:** `app/(app)/reports/page.tsx`, `components/club/stat-tile.tsx`, `components/club/charts.tsx`, `hooks/use-reports.ts`.
- **Steps:**
  1. Install the chart library (ask Mihir to approve; it is a proposed addition): `pnpm --filter @app/web add recharts`, then commit `package.json` and `pnpm-lock.yaml`.
  2. Add the four chart tokens to `globals.css` and `tailwind.config.ts` as described in `UI_SPEC.md` section 2.1 (light and dark values).
  3. Page: `Tabs` Today / This week / This month setting `range`; `useQuery({ queryKey: ['dashboard', range], queryFn, refetchInterval: 10000 })`.
  4. Row of `StatTile`s: Revenue (with "+18% vs previous" when `changePct` is present; text `text-success` when positive, `text-destructive` when negative), Bookings, Court utilisation (percent), New members.
  5. **Revenue by source:** Recharts `BarChart` (horizontal) with `ResponsiveContainer`, one bar per source, fill `hsl(var(--chart-1))`, value labels via `LabelList`. **Revenue by payment mode:** another small bar chart (or `PieChart` if time). **Trend:** `AreaChart` or `LineChart` of `trend[].totalPaise`. Divide paise by 100 before charting and format tooltips with `formatMoney`.
  6. "What we owe" as a `dl` list (tax payable, payroll due, unpaid invoices and overdue count).
  7. "Needs attention" list from `alerts` (low stock, expiring memberships, new leads, pending leave), each a `Link` to the right page.
  8. `PageHeader actions`: "Export CSV" (an `a` styled as `Button variant="outline"` with `href` to the API's `/reports/export.csv?range=…`) and "Share" (`Dialog` calling `POST /reports/shares`, showing the link with a copy button using `navigator.clipboard.writeText`).
- **Mock JSON:** `mocks/dashboard-today.json`, `dashboard-week.json`, `dashboard-month.json` (copy the contract example; generate a believable `trend` of 12 to 30 points).
- **Docs:** Recharts https://recharts.org/en-US/api/BarChart and https://recharts.org/en-US/api/AreaChart and https://recharts.org/en-US/api/ResponsiveContainer
- **Test:** switch ranges (charts update), dark mode (axes and labels readable), narrow width (charts stack), mock an empty period to see the empty state.
- **Done when:** universal checklist ticked. **Bonus for the demo:** leave this page open on a second screen; after Mihir's API is live every sale moves these numbers within 10 seconds.

### K-20: Lead pipeline `/crm` · Tier 2 · depends on: K-10

- **Build:** the follow-up screen that makes the website enquiry matter (Scene 5).
- **Where:** `app/(app)/crm/page.tsx`, `hooks/use-crm.ts`. (To save time, the lead detail is a `Dialog` on the same page, not a separate route.)
- **Steps:** `StatTile`s from `crm/summary` (New, Due today, Overdue); `Tabs` by status (New, Contacted, Quoted, Won, Lost) and a "Follow up today" `Switch`; `Table` (Name, Phone, Source, Plan interest, Next follow-up with `text-destructive` when overdue, Status badge); clicking a row opens a large `Dialog` with: details `dl`, status `Select`, follow-up `Input type="date"`, notes list plus "Add note" form, a quote area ("Create quote": plan `Select`, amount, valid until; "Send quote"), and the primary button **"Convert to member"** opening a nested confirm with `PlanPicker` and payment `Select`. On success toast "Riya Kapoor is now member CC-000124" and link to the profile.
- **Mock JSON:** `mocks/crm-leads.json` (8 leads), `mocks/crm-lead-detail.json`, `mocks/crm-convert.json`.
- **Docs:** shadcn Dialog (link above).
- **Test:** change status, add a note, create and send a quote, convert (row becomes Won).
- **Done when:** universal checklist ticked.

### K-21: Notification bell · Tier 2 · depends on: K-04

- **Build:** the topbar bell so "someone at the club hears about it" (Scenes 3 and 5).
- **Where:** `components/app-shell/topbar.tsx`, `hooks/use-notifications.ts`.
- **Steps:** an icon-only `Button variant="ghost" size="icon"` with `aria-label="Notifications"` and the `Bell` icon, a small count `Badge` when the count is above 0 (poll `GET /notifications/unread-count` every 10 s); clicking opens a `DropdownMenu` listing the latest 8 notifications (title, relative time) from `GET /notifications?limit=8`; clicking one marks it read (`POST /notifications/:id/read`) and navigates to its `link`; a "Mark all read" item at the bottom.
- **Mock JSON:** `mocks/notifications.json` (4 items: low stock, new lead, expiring membership, online order), `mocks/notification-count.json`.
- **Docs:** shadcn Dropdown Menu https://ui.shadcn.com/docs/components/dropdown-menu
- **Test:** the count changes after marking read; navigation works.
- **Done when:** universal checklist ticked; the bell is reachable by keyboard.

---

## 5. Tier 3 tasks (only after every Tier 1 and Tier 2 task is done)

| ID | Task | Depends | Notes |
| --- | --- | --- | --- |
| K-22 | Landing page `/` rewrite: one claim ("Book a court in seconds"), one proof (live "free slots today" from `public/availability`), one next step; follow `skills/design/SKILL.md` section 9 (no gradient hero, no pill badge, no three equal feature cards) | K-15 | Edit `(marketing)/page.tsx` and keep the existing live-status proof pattern |
| K-23 | Orders board `/orders` (members: my orders; staff: tabs by status with one action button per card) | K-12 | Status buttons call `PATCH /orders/:id/status` |
| K-24 | Bar earnings `/bar/earnings` (date, `StatTile`s, by-mode list, by-shift table, print button) | K-17 | Closing report for Scene 4 |
| K-25 | Invoices `/invoices`, `/invoices/new`, `/invoices/[id]` with print (`window.print()` and `print:` variants) | K-10 | Use `useFieldArray` for line items: https://react-hook-form.com/docs/usefieldarray |
| K-26 | Staff and leave `/hr` (employees, leave with approve/reject, payroll tabs) and `/shifts` roster | K-10 | Owner-only actions hidden with `hasPermission` |
| K-27 | Share page `/share/[token]` reusing the chart components | K-19 | Public, no shell; "Shared view, expires <date>" line |
| K-28 | Club settings `/admin/club` (plans table with edit dialog, social windows, bar menu availability) | K-10 | Tab strip like the existing admin layout |
| K-29 | Demo page `/admin/demo` (booking race) | K-14 | Plain form and result panel |
| K-30 | Notifications page `/notifications` | K-21 | Table plus "Mark all read" |
| K-31 | Final polish: dark-mode pass over every page, 390px pass over public pages, copy pass (read each page aloud), empty states | all | Use the design skill checklist (section 11 of `skills/design/SKILL.md`) |

---

## 6. Order of work and cut line

| Order | Tasks |
| --- | --- |
| 1 | K-01 to K-04 (setup, helpers, sidebar) |
| 2 | K-05 to K-07 (mock layer, plans, contact) |
| 3 | K-08 to K-10, K-12 (members list, new member, profile, shop) |
| 4 | K-14 to K-17, K-19 (calendar, public slots, POS, bar tab, dashboard) |
| 5 | Tier 2: K-11, K-13, K-18, K-20, K-21 (inventory, my bookings, kitchen, CRM, bell) |
| 6 | Tier 3 list (section 5), then polish |
| Throughout | When Mihir announces an endpoint is live (availability and bookings first), switch finished pages to real data one module at a time |

**Cut line (if you fall behind):** drop all of Tier 3, then the staff variant parts of K-13, the quote area in K-20 (keep status, notes and Convert), the pie chart in K-19 (bars only), and the "Add product" form in K-11. **Never skip** K-14 (calendar), K-17 (bar tab) or K-19 (dashboard): they are what the judges will look at.

---

## 7. When you're stuck

### The debugging routine (do these in order before asking)

1. **Read the error.** In the terminal running `pnpm dev:web`, or in the browser's Console (right-click → Inspect → Console). Read the first red line out loud; it usually names the file and line.
2. **Is it a typo or an import?** "Cannot find module" or "X is not defined" almost always means a wrong path or a missing import. Compare with a working file.
3. **Refresh data problems:** open the Network tab. Is the request red? Click it and read the **Response**. A 401 means you are logged out; a 400 means the body is wrong (compare with the contract); a 404 means the URL is wrong or Mihir has not built it yet.
4. **Mock or real?** Check `NEXT_PUBLIC_USE_MOCKS` in your `.env`; restart `pnpm dev:web` after changing it (environment variables are read at start-up).
5. **Types:** run `pnpm typecheck`. Fix the first error only, then run it again (later errors are often caused by the first).
6. **Simplify:** comment out half of the page until it works, then add things back one at a time.
7. **Undo safely:** `git status` shows what you changed; `git diff` shows the details; `git stash` temporarily hides your changes so you can check if the problem was there before.
8. **Search:** paste the error message into a search engine, or check the docs links above.
9. **Rubber duck:** write the problem as a message to Mihir (step 10 below); half the time you find the answer while writing it.

### When to ping Mihir

Ping right away when:

- A response from the real API does not match `API_CONTRACT.md` (send the endpoint, what you expected, what you got, and a screenshot of the Network tab Response).
- You get a 401 or 403 and you are sure you are logged in with the right user.
- You need a new endpoint, a field, or a permission that is not in the contract.
- `pnpm install`, `pnpm infra:up`, or `pnpm setup` fails.
- The page worked yesterday on the real API and does not today.
- Git shows a merge conflict you do not understand. **Do not delete files to fix it**; stop and ask.

Do **not** ping for: styling questions (try the design skill and the existing pages first), how a library works (docs links), or things you can test with mock JSON.

### A good message to Mihir

> Page: `/courts` · Task K-14 · What I expected: the grid shows 4 courts · What I see: only 1 court · Network tab: `GET /courts/availability?date=2026-10-09` returns 200 with 1 item (screenshot) · I already tried: restarted the dev server, `USE_MOCKS=false`.

### Git survival kit

```bash
git checkout -b khushi/members-list      # start a branch for each task
git add -A && git commit -m "feat(members): add members table"
git pull --rebase origin main             # get the latest work before you push
git push -u origin khushi/members-list    # then open a pull request
```

Never commit `.env`. Never force-push. If a command scares you, ask first.
