# Issue 59 — spacing and layout audit

This source audit covers all 45 page entry points. It is not a visual acceptance record.

| Page | Layout review |
| --- | --- |
| `(app)/admin/club` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/demo` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/iam/groups` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/iam/permissions` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/iam/policies` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/iam/roles` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/iam/users/[id]` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin/iam/users` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/admin` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/bar/earnings` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/bar/kitchen` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/bar/menu` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/bar` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/bar/tabs/[id]` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/bookings` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/courts` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/crm` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/dashboard` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/hr` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/inventory` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/invoices/[id]` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/invoices/new` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/invoices` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/members/[id]` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/members/new` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/members` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/membership` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/notifications` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/orders` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/pos` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/profile` | Redirect; destination owns spacing. |
| `(app)/reports` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(app)/shifts` | Shared shell width and navigation entrance; section wrappers use space-y-8. Tables, tabs, headers, and dialogs inherit shared overflow fixes where used. |
| `(auth)/forgot-password` | Centered credential form; retains compact field spacing. Shared dialog fixes apply where used. |
| `(auth)/login` | Centered credential form; retains compact field spacing. Shared dialog fixes apply where used. |
| `(auth)/set-password` | Centered credential form; retains compact field spacing. Shared dialog fixes apply where used. |
| `(auth)/signup` | Centered credential form; retains compact field spacing. Shared dialog fixes apply where used. |
| `(marketing)/contact` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `(marketing)/join` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `(marketing)` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `(marketing)/plans` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `(marketing)/play` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `(marketing)/share/[token]` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `(marketing)/shop` | Public container and section padding use the spacing scale; shared dialogs and tabs inherit fixes where used. |
| `site/[slug]` | Standalone public page; retains its own content container. |

## Confirmed fixes

- Standardize 28 immediate page section wrappers across 27 page files to `space-y-8`; preserve form field spacing and print layout.
- Let shell content shrink, wrap header actions and report labels, and wrap pagination controls.
- Contain wide tables and tab bars with local scrolling; retain all columns and keyboard tab activation.
- Correct dialog CSS subtraction, use dynamic viewport height where supported, preserve scrolling, reserve close-button space, and wrap footer actions.
- Use theme tokens for the dialog overlay. Animate navigation through a remounted Next template and tab content, with reduced-motion support.

## Manual acceptance still required

Check mobile and desktop widths in both themes, including long titles, shifts actions, report tabs, IAM tables, open editors, invoice printing, and keyboard focus. Browser inspection was rejected by automatic approval review because the requested localhost protocol was not allowed; no alternative browser access was attempted. Automated DOM tests check structure and interaction, not rendered geometry.
