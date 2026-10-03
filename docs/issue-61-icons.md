# Issue 61 — website icon audit

The UI now uses Lucide for structural glyphs, including the busy-button loader. Navigation, view selectors and icon-only controls use 16px glyphs with Lucide's default 2-unit stroke. The radio-menu selection dot remains 8px because it is an indicator, not a pictogram. Revenue SVGs remain data charts.

- Navigation: sidebar, topbar, calendar/view controls and notification glyphs have consistent sizing and decorative SVG semantics.
- Buttons: IAM status, pagination, assignment removal, statement removal and detail-close controls have specific accessible names. Text actions retain their labels; redundant decorative glyphs were removed. User inspection is a single link rather than a nested link/button.
- Empty states: the user search uses the shared text-led empty state. Oversized decorative glyphs were removed, following the design skill.
- Status badges: retain explicit status text alongside theme-aware colors; no state relies on color alone.
- Marketing/auth: theme controls keep their named button and hide their Sun/Moon SVGs from accessible names. Page loading uses content-shaped skeletons rather than an oversized custom spinner. Public text navigation remains text-led.

Automated source checks cover production TSX files for icon-set, size, stroke, decorative semantics, emoji and custom pictograms. DOM regression tests exercise named controls, unchanged mutations, root restrictions, loading, policy dismissal and empty states. Manual visual acceptance in both themes remains pending because the previous localhost browser inspection was rejected by automatic approval review for its protocol.
