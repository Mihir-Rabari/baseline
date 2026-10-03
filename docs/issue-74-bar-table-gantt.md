# Issue 74 — Bar floor table bookings Gantt / timeline view

## Summary

Implemented interactive table bookings tracking below the bar tables layout on `/bar`:

1. **Gantt / Timeline View**:
   - Visual time-track for all bar tables (`T1`–`T10`) mapped across operating hours (10:00 to 23:00) with 30-minute and 1-hour resolution.
   - Distinct status color-coding conforming to design tokens:
     - `CONFIRMED`: primary accent
     - `SEATED`: success status
     - `COMPLETED`: muted
     - `CANCELLED`: strikethrough muted
   - Interactive drag and drop to move bookings between tables.
   - Quick time shift handles (-30m / +30m) and duration resize handles.
   - Real-time visual overlap conflict detection with immediate alert warnings.

2. **Alternative Views**:
   - **Day schedule view**: Hourly breakdown of table occupancy and booked guest counts, allowing staff to quickly identify available tables for walk-ins.
   - **List view**: Chronological list with search (guest name, phone, notes), table filter dropdown, and status filter pills. Quick action to seat guests directly from the list.

3. **Reservations & Conflict Management**:
   - "Book Table" modal with live conflict detection against active bookings for the selected table and time window.
   - Prevents booking overlaps before submission and displays conflicting reservation details.
   - "Seat & Open Tab" workflow allowing staff to transition confirmed bookings directly to seated status and open an active tab.

4. **Pure Utility & Client Gateway**:
   - `apps/web/src/lib/booking-timeline.ts`: Pure timeline positioning, minute offsets, interval overlap checks, time shifting, and duration resizing.
   - `@packages/validation`: Added `BarTableBookingSchema`, `BarTableBookingListQuerySchema`, `CreateBarTableBookingRequestSchema`, and `UpdateBarTableBookingRequestSchema`.
   - `apps/web/src/lib/mock-bar.ts`: In-memory booking store with range query support, conflict validation, move/resize, and status transitions.
   - `apps/web/src/lib/bar-api.ts`: Gateway endpoints for `/api/v1/bar/bookings`.

## Backend Follow-up

Assigned to @Mihir-Rabari per issue #74:
- Database migration to persist `bar_table_bookings` in PostgreSQL.
- Server-side range query `GET /api/v1/bar/bookings?date=...&from=...&to=...&tableId=...` and overlap validation in `bar.service.ts`.

## Verification & Quality Gates

- `apps/web/src/lib/booking-timeline.test.ts`: 6 unit tests verifying timeline positioning, minute math, time shifting, and interval overlap logic.
- `apps/web/src/lib/mock-bar.test.ts`: Added tests verifying range queries, conflict rejection, move/extend updates, and status transitions.
- `apps/web/src/lib/bar-api.test.ts`: Added tests verifying versioned REST transport for table booking endpoints.
- `apps/web/src/app/(app)/bar/table-bookings.test.tsx`: 7 component tests verifying timeline rendering, view switching (Timeline, Day, List), search/table/status filtering, shift adjustments, conflict warnings, modal creation, and seating.
- Zero ESLint warnings (`--max-warnings 0`), clean TypeScript typecheck (`tsc --noEmit`), and full icon convention compliance.
