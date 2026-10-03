# Issue 60 — Khushi dashboard work

The owner overview now uses the existing report contract for today's revenue, bookings, court occupancy, shop orders, new members, new leads, and bar tabs. Revenue charts use the same report data; empty revenue has an explicit empty state.

Quick actions lead to court booking, counter sale, member registration and invoice creation, and require the destination's permissions. Alert links also respect permissions. Owner, desk, bar and member workspaces retain their separate data access.

Bookings, recent orders, pending-order totals and the roster load independently. Optional failures have retry controls and do not hide the report. Pending-order counts add pagination totals for PLACED, READY and OUT_FOR_DELIVERY, rather than counting a preview page.

## Backend follow-up

[Issue 87](https://github.com/Mihir-Rabari/baseline/issues/87) is assigned to Mihir, matching the backend allocation in #60:

- The roster is capped at 500 rows. The overview shows Unavailable at the cap instead of reporting a partial staff total.
- The staff bookings API lacks a future-time scope. The overview filters and sorts a bounded first-page preview and discloses further pages; a complete nearest-upcoming preview needs server support.

These limits keep #60's backend aggregate work open. The frontend PR addresses Khushi's portion.

## Validation

Nineteen focused workspace/dashboard tests cover content, role isolation, compound permissions, chart/empty states, pending metadata counts, roster limits, preview filtering/order, loading, and independent retries. Browser visual acceptance remains pending because the previous localhost inspection was rejected by automatic approval review for its protocol.
