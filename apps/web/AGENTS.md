# Frontend Web Application (`apps/web`) — Subtree Operating Manual

> **Scope**: Next.js App Router, React client/server components, Tailwind CSS styling, TanStack Query hooks, AuthContext integration, and permission-aware UI.

> **Before writing any UI, read `skills/design/SKILL.md`.** It is the design law
> for this app: screen structure, colour tokens, typography, icons, spacing, and
> the four states every screen owes the user. The rules below are the ones most
> often broken; the skill has the full picture.

---

## 1. Non-Negotiables

These exist because each one has already shipped to users at least once.

1. **No literal Tailwind colours.** `bg-indigo-600`, `text-emerald-500`,
   `border-rose-300` are bugs — they have no dark-mode counterpart. Every colour
   is a token from `globals.css`: neutrals for the interface, `primary` for the
   one action on a screen, `success` / `warning` / `destructive` for system state
   only.
2. **No emoji, anywhere.** Icons are `lucide-react`, and only for navigation
   destinations, icon-only buttons, or repeated list rows — never next to a
   heading or "for visual interest".
3. **No gradients.** Not on heroes, cards, or buttons.
4. **Marketing content never appears inside `(app)`.** A value proposition on a
   signed-in dashboard means the screen is in the wrong route group.
5. **Never hardcode `http://localhost:3001`.** Import `API_BASE_URL` from
   `@/lib/api-client`. Hardcoded hosts ship to production.
6. **Never render credentials or secrets** in UI that reaches production. Gate
   development helpers behind `process.env.NODE_ENV !== 'production'`.
7. **Write like a colleague.** "Services", not "Infrastructure Status Probe".
   No exclamation marks, no "seamlessly", no narrating the tech stack at the user.

## 2. Route Groups & Layout Ownership

`src/app/` is split into three groups. Parentheses set layout, not URL —
`(app)/dashboard/page.tsx` still serves `/dashboard`.

| Group | Layout owns | Put a screen here when |
|---|---|---|
| `(marketing)` | Public header, footer | It is public and sells the product |
| `(app)` | Sidebar, topbar, **auth guard**, page width | It requires a signed-in user |
| `(auth)` | Bare centred frame | It is credential entry |

**A screen inside `(app)` renders content only.** It starts with
`if (!user) return null;` — no `isLoading` branch, no signed-out fallback, no
`max-w-*`, no navigation. The layout owns all of it. It opens with exactly one
`<PageHeader>`.

The root `app/layout.tsx` holds `<html>`, fonts, and `<Providers>`. No chrome.

## 3. Generated Files

`globals.css` and the font block in `app/layout.tsx` are written by the CLI from
the selected theme (`src/themes.ts`). The font block sits between
`FONTS:START` / `FONTS:END` markers — edit freely, but keep the markers or
`--theme` stops working.

If you render the app's name as a wordmark in a new layout, add that file to
`brandFiles` in `src/generator.ts` or the rename will miss it.

## 4. Subtree Architecture & Conventions

1. **Package Boundaries**:
   - **Must never** import `@packages/db` or connect directly to PostgreSQL, Redis, or MinIO/S3.
   - All backend communication must pass through `@/lib/api-client` (which uses `credentials: 'include'`).

2. **Component Conventions**:
   - Client components must declare `'use client'` at the very top of the file.
   - Separate presentational components from data fetching hooks (`hooks/use-*.ts`).
   - Shared shell pieces live in `components/app-shell/`; public ones in `components/marketing/`.

3. **Authentication & Authorization State**:
   - Session state is managed via `useAuth()` (`contexts/auth-context.tsx`).
   - Use `hasPermission('namespace:action')` for conditional rendering of navigation items and action buttons.
   - *Note*: Client-side hiding is for UX only; backend route guards enforce actual authorization.

4. **Testing Expectations**:
   - Test client API interactions with unit tests for `@/lib/api-client`.
   - Ensure Next.js builds cleanly (`pnpm build`) with zero static generation errors.
   - `lint` runs with `--max-warnings 0`; a single unused import fails the build.
