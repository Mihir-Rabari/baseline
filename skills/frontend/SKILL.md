---
name: frontend
description: Next.js App Router, shadcn/ui components, Tailwind CSS, TanStack Query, AuthContext, and permission-aware UI.
---

# Frontend Skill — Next.js 15, shadcn/ui & Tailwind CSS

> **Read `skills/design/SKILL.md` first.** That file decides what the UI should
> look like — screen structure, colour, type, icons, and the states every screen
> owes the user. This file covers the plumbing underneath it. Wiring a screen up
> correctly and still shipping a gradient hero with three emoji is a failure.

## 1. When to Use
Use this skill when building or editing Next.js UI pages, React client/server components, shadcn/ui styled primitives, Tailwind styling, TanStack Query hooks, or AuthContext integrations.

## 2. Route Groups & Layout Ownership

`apps/web/src/app/` is split into three groups. Route groups are parentheses —
they set layout, not URL, so `(app)/dashboard/page.tsx` still serves
`/dashboard`.

| Group | Layout owns | Put a screen here when |
|---|---|---|
| `(marketing)` | Public header, footer | It is public and sells the product |
| `(app)` | Sidebar, topbar, auth guard, page width | It requires a signed-in user |
| `(auth)` | Bare centred frame | It is credential entry |

**The `(app)` layout already guarantees a signed-in user.** A screen inside it
starts with `if (!user) return null;` and renders content — no `isLoading`
branch, no signed-out fallback, no `max-w-*`, no navigation. Those exist once,
in the layout. Duplicating them is how the four screens drifted apart before.

The root `app/layout.tsx` holds `<html>`, fonts, and `<Providers>` only. It
renders no chrome, because chrome differs per group.

## 3. Shell Components

In `components/app-shell/`:

- **`PageHeader`** — title, one-sentence description, up to two actions. Every
  `(app)` screen opens with exactly one.
- **`EmptyState`** — what a list renders when it has nothing. Reach for it before
  rendering records whose every field is blank.
- **`Sidebar`** / **`Topbar`** — primary nav and account menu. Adding a
  destination means adding it to `Sidebar`'s `sections`, not to a page.

In `components/marketing/`: `SiteHeader` — public nav only.

## 4. Theming

`globals.css` and the font block in `app/layout.tsx` are **generated** from the
selected theme (`src/themes.ts` in the CLI). Each theme sets its own palette,
type pairing, and corner radius.

- Colour comes from CSS-variable tokens wired into `tailwind.config.ts`. Add a
  token before reaching for a literal Tailwind colour.
- The font block in `layout.tsx` sits between `FONTS:START` / `FONTS:END`
  markers. Edit freely — but keep the markers, or regenerating the theme stops
  working.
- Dark/light switching is `next-themes`. Everything must be legible in both.

## 5. Data Fetching & Session State
- **Client Components**: Declare `'use client'` at the very top of interactive components.
- **Data Fetching**: Use `@/lib/api-client` backed by TanStack Query hooks in `hooks/` with staleTime and refetch controls.
- **Session State**: Managed via `useAuth()` (`contexts/auth-context.tsx`) leveraging server-side HTTP-only session cookies (`credentials: 'include'`).
- **API base URL**: import `API_BASE_URL` from `@/lib/api-client`. Never hardcode `http://localhost:3001` — it ships to production and points at the developer's laptop.

## 6. shadcn/ui Component Suite & Radix Primitives
`apps/web/src/components/ui/` contains standard, composable, unstyled-primitive-backed UI components:
- **Button**: Powered by Radix `Slot` (`asChild`), `class-variance-authority` (`cva`), and responsive variants (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`).
- **Dialog / Modal**: Radix Dialog with backdrop overlay, animated transition, header, description, content, and close triggers.
- **DropdownMenu**: Radix DropdownMenu with trigger, submenus, radio groups, checkboxes, and keyboard shortcuts.
- **Form Controls**: Styled `Input`, Radix `Label`, Radix `Select`, Radix `Switch`.
- **Feedback & State**: `Toaster` (`sonner`), `Badge` (`cva`, with `success` / `warning` / `error` status variants), `Skeleton`, `Alert`, and `Tooltip`.

Status variants on `Badge` and `Alert` use the `success` / `warning` /
`destructive` tokens. They are for system state, not decoration.

## 7. Dynamic Permission-Aware UI
- Use `hasPermission(action)` from `useAuth()` to conditionally display admin navigation and action buttons.
- **Zero-Trust Invariant**: UI element hiding is an aesthetic convenience. All privileged backend API routes must strictly enforce server-side `requirePermission(...)`.
- `api-client.ts` uses `credentials: 'include'` on all `fetch` requests so HTTP-only session cookies are transmitted automatically.
- Do not render secrets or default credentials in UI that ships to production. Gate development helpers behind `process.env.NODE_ENV !== 'production'`.

## 8. Mandatory Testing Expectations
- Test client API interactions with unit tests for `@/lib/api-client`.
- Prioritize behavioral testing (auth state changes, error handling, session expiration recovery) over brittle full-page DOM snapshots.
- Ensure Next.js builds cleanly (`pnpm build`) with zero static generation errors across all routes.
- Run `pnpm --filter @app/web lint` — it is `--max-warnings 0`, so an unused import fails the build.
