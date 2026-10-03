CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS member_code_seq START 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS tab_number_seq START 1;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_no_overlap" EXCLUDE USING gist ("court_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_shape" CHECK (
  "ends_at" > "starts_at" AND (
    ("kind" = 'BOOKING'
       AND "ends_at" - "starts_at" = interval '1 hour'
       AND extract(minute FROM ("starts_at" AT TIME ZONE 'UTC')) IN (0, 30)
       AND extract(second FROM ("starts_at" AT TIME ZONE 'UTC')) = 0)
    OR ("kind" = 'SOCIAL'
       AND "ends_at" - "starts_at" = interval '1 hour'
       AND extract(minute FROM ("starts_at" AT TIME ZONE 'UTC')) = 0
       AND extract(second FROM ("starts_at" AT TIME ZONE 'UTC')) = 0)
    OR "kind" = 'MAINTENANCE'
  )
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_no_overlap" EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("member_id" IS NOT NULL AND "status" IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW'));
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_holder_check" CHECK ("member_id" IS NOT NULL OR "guest_name" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_order_check" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_discount_pct_check" CHECK ("discount_pct" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_time_order_check" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, daterange("from_date", "to_date", '[]') WITH &&) WHERE ("status" = 'APPROVED');
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_date_order_check" CHECK ("to_date" >= "from_date");
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_discounts_check" CHECK (
  "court_discount_pct" BETWEEN 0 AND 100
  AND "shop_discount_pct" BETWEEN 0 AND 100
  AND "bar_discount_pct" BETWEEN 0 AND 100
);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_fee_check" CHECK ("monthly_fee_paise" >= 0);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_max_bookings_check" CHECK ("max_bookings_per_day" >= 1);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stock_qty_check" CHECK ("stock_qty" >= 0);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_qty_check" CHECK ("qty" > 0);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_pct_check" CHECK ("discount_pct" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_qty_check" CHECK ("qty" > 0);
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_discount_pct_check" CHECK ("discount_pct" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_paise" <> 0);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_one_bill_to_check" CHECK (("member_id" IS NULL) <> ("business_client_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_check" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_checkins" ADD CONSTRAINT "member_checkins_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_shift_id_staff_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."staff_shifts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_staff_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."staff_shifts"("id") ON DELETE set null ON UPDATE no action;
