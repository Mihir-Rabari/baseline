---
name: design
description: Visual design law for the generated app — screen structure, colour tokens, typography, icons, spacing, and the states every screen owes the user.
---

# Design Skill — What Good Looks Like Here

## 1. When to Use

Read this **before** writing or editing any UI: a new screen, a landing page, a
component, a layout, or any Tailwind class. `frontend` covers the plumbing —
routing, data fetching, permissions. This covers what the result should look
like.

If you are about to reach for a gradient, an emoji, or a third accent colour,
you are in the wrong file. Read section 3.

## 2. Screen Structure

The app is split into three route groups, each with its own chrome. Put a new
screen in the right one; do not invent a fourth.

| Group | Route | Chrome | For |
|---|---|---|---|
| `(marketing)` | `/` | Public header + footer | Signed-out, sells the product |
| `(app)` | `/dashboard`, `/profile`, `/admin` | Sidebar + topbar | Signed-in work |
| `(auth)` | `/login`, `/signup` | Bare centred frame | Credential entry only |

**Rules that follow from the split:**

- Marketing content never appears inside `(app)`. A gradient hero banner at the
  top of a signed-in dashboard is the single most common tell of a generated
  app. If a logged-in user is reading a value proposition, the structure is wrong.
- Screens inside `(app)` render **content only**. The layout owns navigation,
  the auth check, the page width, and the vertical rhythm. A page that checks
  `isAuthenticated`, sets its own `max-w-*`, or renders its own nav is
  duplicating the shell.
- Every `(app)` screen opens with exactly one `<PageHeader>`. It carries the
  title, one sentence of description, and at most two actions.
- There is exactly one `container` in any given tree. Nesting a second one
  double-pads the page.

## 3. Colour

**All colour comes from tokens in `globals.css`.** If you type a literal
Tailwind colour — `bg-indigo-600`, `text-emerald-500`, `border-rose-300` — you
have introduced a bug: those classes have no dark-mode counterpart, so the
screen breaks in the mode you did not test.

The palette is deliberately almost monochrome. The tokens:

- **Neutrals** — `background`, `foreground`, `card`, `muted`,
  `muted-foreground`, `border`, `input`. These carry the entire interface.
- **`primary`** — one accent, reserved for *the* action on a screen. Two primary
  buttons side by side means neither is primary.
- **Status: `success`, `warning`, `destructive`** — these are the only hues that
  mean something on their own. A coloured pixel signals a system state. Do not
  spend them on decoration.

Corollaries:

- Never colour an icon to make it look nice. Colour it only when it carries a
  status the adjacent text does not already carry.
- Never use colour as the *only* signal — pair it with a label or an icon, or a
  red/green colourblind user sees nothing.
- Do not add a gradient. Not on a hero, not on a card, not on a button.

## 4. Typography

The theme picks the families; you pick the roles. Use weight and size, not
colour, to build hierarchy.

- **Page title** — `text-2xl font-semibold tracking-tight`. One per screen.
- **Section heading** — `text-lg font-semibold` or `CardTitle`.
- **Body** — default size, `text-muted-foreground` for secondary text.
- **Mono (`font-mono`)** — identifiers, code, commands, timestamps, and raw
  values only. Mono on a heading or a count is decoration; it reads as a
  terminal cosplay.
- **Numbers that update in place** — add `.tabular` so the column stops jittering.

Avoid `font-extrabold`, `uppercase tracking-wider` labels on everything, and
`text-[10px]`. If a label needs to be that small to fit, the layout is too dense.

## 5. Icons

Icons are `lucide-react`, and they are structural, not ornamental.

**Use one when** it marks a destination in navigation, is the entire content of
an icon-only button (with an `aria-label`), or repeats across rows of a list so
the eye can scan.

**Do not use one** next to a heading, inside a button that already has a verb,
beside body text, or to "add visual interest". A screen with nine different
icons has no hierarchy.

**Never use emoji.** Not 🚀 in a hero, not ✨ on a feature, not 👑 on a badge.
They render differently on every platform, they cannot be themed, and they are
the loudest possible signal that nobody designed the screen.

## 6. Every Screen Owes Four States

A screen is not done when the happy path renders. Handle all four, explicitly:

1. **Loading** — `<Skeleton>` shaped like the content that is coming. Not a
   spinner, not the text "Loading...", not `animate-pulse` on three dots.
2. **Empty** — `<EmptyState>` from `@/components/app-shell/empty-state`. Name the
   absence, say what fills it, offer the one next step. **Never** render a grid
   of cards whose every field reads "None listed" — a screen full of empty
   records looks broken and buries the action.
3. **Error** — say what failed and what to do about it, in a sentence a user can
   act on. Show the raw message secondary, in mono.
4. **Content** — the happy path.

## 7. Density and Layout

- A card needs a reason to exist. Three fields and a button is a list row, not a
  card. Wrapping every item in a bordered box triples the height and halves what
  fits on screen.
- Prefer a definition list (`<dl>` with `divide-y`) over a card grid for
  key/value data. It is denser, scans faster, and has no arbitrary borders.
- Lists longer than ~25 rows need a table with pagination, not an unbounded grid.
- Spacing comes from the 4px scale Tailwind already gives you. `space-y-8`
  between sections, `space-y-4` within one, `gap-2` between related controls.
- Shadows: at most one level, and only on things that genuinely float
  (dropdowns, dialogs). A `shadow` on every card is noise.

## 8. Writing

The copy is part of the design, and it is where generated UI gives itself away.

- Write what a colleague would say. "Services", not "Infrastructure Status
  Probe". "Permissions", not "Live Effective Permissions Breakdown".
- One sentence of description under a heading. If it runs to three lines of
  architecture vocabulary, delete it.
- Do not narrate the technology to the user: "scrypt-backed cryptographic
  hashing", "type-safe runtime contracts", "deterministic evaluation order".
  They came to do a task.
- No exclamation marks. No "seamlessly", "powerful", "robust", "enterprise-grade".
- Buttons take a verb: "Save", "Create account", "Sign in". Not "Save Profile
  Changes", not "Submit".
- Sentence case for headings and buttons. Not Title Case, not ALL CAPS.

## 9. The Landing Page Is Not Optional

Every generated app ships a real landing page at `/`. It is the first thing
anyone sees and it is never a placeholder.

Structure: **one claim, one proof, one next step.**

- A headline that says what the product does, in the user's words.
- One paragraph, no more, expanding it.
- One primary action; an optional secondary next to it.
- Sections that prove the claim — real content, real data, real screenshots.
- A closing action.

What makes it read as generated: a full-bleed gradient banner standing in for a
hero, a pill badge above the headline announcing the product is "production
ready", exactly three feature cards of equal weight each with a decorative icon,
and a wall of logos. Contrast, spacing, and type hierarchy do the work instead.

## 10. Accessibility Is Part of Design

- Every interactive element reachable and visible on keyboard focus. Do not
  remove the focus ring.
- Icon-only buttons carry an `aria-label`; decorative icons carry `aria-hidden`.
- Body text meets 4.5:1 contrast, in **both** modes. Check the mode you did not
  build in.
- Mark the current nav item with `aria-current="page"`.
- Errors get `role="alert"`; inputs get a real `<Label htmlFor>` and
  `autoComplete`.

## 11. Checklist Before You Call a Screen Done

- [ ] No literal Tailwind colours — every colour is a token.
- [ ] Renders correctly in light **and** dark.
- [ ] No emoji. Icons only where section 5 allows.
- [ ] Loading, empty, error, and content states all handled.
- [ ] One `<PageHeader>`; no page-level auth check or width override.
- [ ] Copy passes section 8 — read it aloud.
- [ ] Keyboard reachable, focus visible, labels present.
- [ ] `pnpm --filter @app/web lint` and `build` are clean.
