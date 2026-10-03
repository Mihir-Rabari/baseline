CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE SEQUENCE member_code_seq;
CREATE SEQUENCE invoice_number_seq;
CREATE SEQUENCE order_number_seq;
CREATE SEQUENCE tab_number_seq;
--> statement-breakpoint
ALTER TABLE court_occupancies ADD CONSTRAINT court_occupancies_no_overlap
  EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);
ALTER TABLE court_occupancies ADD CONSTRAINT court_occupancies_shape CHECK (
  ends_at > starts_at AND (
    (kind = 'BOOKING' AND ends_at - starts_at = interval '1 hour'
      AND extract(minute FROM (starts_at AT TIME ZONE 'UTC')) IN (0, 30)
      AND extract(second FROM (starts_at AT TIME ZONE 'UTC')) = 0)
    OR (kind = 'SOCIAL' AND ends_at - starts_at = interval '1 hour'
      -- Club-local whole hours in Asia/Kolkata fall at UTC minute 30.
      -- Revisit this constraint before changing CLUB_TIMEZONE to another offset.
      AND extract(minute FROM (starts_at AT TIME ZONE 'UTC')) = 30
      AND extract(second FROM (starts_at AT TIME ZONE 'UTC')) = 0)
    OR kind = 'MAINTENANCE'
  )
);
--> statement-breakpoint
ALTER TABLE bookings ADD CONSTRAINT bookings_member_no_overlap
  EXCLUDE USING gist (member_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (member_id IS NOT NULL AND status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW'));
ALTER TABLE bookings ADD CONSTRAINT bookings_member_or_guest CHECK (member_id IS NOT NULL OR guest_name IS NOT NULL);
ALTER TABLE bookings ADD CONSTRAINT bookings_time_order CHECK (ends_at > starts_at);
ALTER TABLE bookings ADD CONSTRAINT bookings_discount_pct CHECK (discount_pct BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE staff_shifts ADD CONSTRAINT staff_shifts_no_overlap
  EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);
ALTER TABLE staff_shifts ADD CONSTRAINT staff_shifts_time_order CHECK (ends_at > starts_at);
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_approved_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(from_date, to_date, '[]') WITH &&)
  WHERE (status = 'APPROVED');
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_date_order CHECK (to_date >= from_date);
--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_discounts CHECK (
  court_discount_pct BETWEEN 0 AND 100 AND shop_discount_pct BETWEEN 0 AND 100 AND bar_discount_pct BETWEEN 0 AND 100
);
ALTER TABLE plans ADD CONSTRAINT plans_monthly_fee CHECK (monthly_fee_paise >= 0);
ALTER TABLE plans ADD CONSTRAINT plans_daily_limit CHECK (max_bookings_per_day >= 1);
ALTER TABLE products ADD CONSTRAINT products_stock_nonnegative CHECK (stock_qty >= 0);
ALTER TABLE order_items ADD CONSTRAINT order_items_qty_positive CHECK (qty > 0);
ALTER TABLE order_items ADD CONSTRAINT order_items_discount_pct CHECK (discount_pct BETWEEN 0 AND 100);
ALTER TABLE tab_items ADD CONSTRAINT tab_items_qty_positive CHECK (qty > 0);
ALTER TABLE tab_items ADD CONSTRAINT tab_items_discount_pct CHECK (discount_pct BETWEEN 0 AND 100);
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_qty_positive CHECK (qty > 0);
ALTER TABLE payments ADD CONSTRAINT payments_amount_nonzero CHECK (amount_paise <> 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_one_bill_to CHECK ((member_id IS NULL) <> (business_client_id IS NULL));
ALTER TABLE leads ADD CONSTRAINT leads_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL);
--> statement-breakpoint
-- These references are added after all domain tables exist to avoid circular schema imports.
ALTER TABLE memberships ADD CONSTRAINT memberships_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id);
ALTER TABLE member_checkins ADD CONSTRAINT member_checkins_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE tabs ADD CONSTRAINT tabs_shift_id_staff_shifts_id_fk FOREIGN KEY (shift_id) REFERENCES staff_shifts(id) ON DELETE SET NULL;
ALTER TABLE payments ADD CONSTRAINT payments_shift_id_staff_shifts_id_fk FOREIGN KEY (shift_id) REFERENCES staff_shifts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_status_values CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED', 'REPLACED'));
ALTER TABLE membership_events ADD CONSTRAINT membership_events_type_values CHECK (type IN ('CREATED', 'RENEWED', 'UPGRADED', 'DOWNGRADE_SCHEDULED', 'DOWNGRADED', 'CANCEL_SCHEDULED', 'CANCELLED', 'EXPIRED'));
ALTER TABLE membership_reminders ADD CONSTRAINT membership_reminders_kind_values CHECK (kind IN ('T30', 'T7', 'T1', 'EXPIRED'));
ALTER TABLE social_sessions ADD CONSTRAINT social_sessions_status_values CHECK (status IN ('OPEN', 'CANCELLED'));
ALTER TABLE bookings ADD CONSTRAINT bookings_kind_values CHECK (kind IN ('STANDARD', 'SOCIAL', 'TRIAL'));
ALTER TABLE bookings ADD CONSTRAINT bookings_status_values CHECK (status IN ('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'));
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_values CHECK (payment_status IN ('UNPAID', 'PAID', 'WAIVED', 'REFUNDED'));
ALTER TABLE bookings ADD CONSTRAINT bookings_channel_values CHECK (channel IN ('DESK', 'PHONE', 'ONLINE', 'WEBSITE_TRIAL'));
ALTER TABLE court_occupancies ADD CONSTRAINT court_occupancies_kind_values CHECK (kind IN ('BOOKING', 'SOCIAL', 'MAINTENANCE'));
ALTER TABLE products ADD CONSTRAINT products_category_values CHECK (category IN ('RACKET', 'BALL', 'SHOE', 'ACCESSORY', 'APPAREL'));
ALTER TABLE orders ADD CONSTRAINT orders_channel_values CHECK (channel IN ('POS', 'ONLINE'));
ALTER TABLE orders ADD CONSTRAINT orders_fulfilment_values CHECK (fulfilment IN ('COUNTER', 'PICKUP', 'DELIVERY'));
ALTER TABLE orders ADD CONSTRAINT orders_status_values CHECK (status IN ('COMPLETED', 'PLACED', 'READY', 'OUT_FOR_DELIVERY', 'COLLECTED', 'DELIVERED', 'CANCELLED'));
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_values CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_values CHECK (reason IN ('SALE_COUNTER', 'SALE_ONLINE', 'RESTOCK', 'ADJUSTMENT', 'CANCEL_RETURN'));
ALTER TABLE menu_items ADD CONSTRAINT menu_items_category_values CHECK (category IN ('DRINK', 'FOOD', 'SNACK'));
ALTER TABLE menu_items ADD CONSTRAINT menu_items_station_values CHECK (station IN ('BAR', 'KITCHEN'));
ALTER TABLE tabs ADD CONSTRAINT tabs_status_values CHECK (status IN ('OPEN', 'SETTLED', 'VOID'));
ALTER TABLE kitchen_tickets ADD CONSTRAINT kitchen_tickets_station_values CHECK (station IN ('BAR', 'KITCHEN'));
ALTER TABLE kitchen_tickets ADD CONSTRAINT kitchen_tickets_status_values CHECK (status IN ('NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'));
ALTER TABLE tab_items ADD CONSTRAINT tab_items_status_values CHECK (status IN ('PENDING', 'SENT', 'VOID'));
ALTER TABLE payments ADD CONSTRAINT payments_source_values CHECK (source IN ('COURT', 'SHOP', 'BAR', 'MEMBERSHIP', 'INVOICE'));
ALTER TABLE payments ADD CONSTRAINT payments_kind_values CHECK (kind IN ('PAYMENT', 'REFUND'));
ALTER TABLE payments ADD CONSTRAINT payments_method_values CHECK (method IN ('CASH', 'CARD', 'UPI'));
ALTER TABLE invoices ADD CONSTRAINT invoices_status_values CHECK (status IN ('DRAFT', 'SENT', 'PAID', 'VOID'));
ALTER TABLE report_shares ADD CONSTRAINT report_shares_default_range_values CHECK (default_range IN ('today', 'week', 'month'));
ALTER TABLE leads ADD CONSTRAINT leads_source_values CHECK (source IN ('WEBSITE_ENQUIRY', 'WEBSITE_TRIAL', 'WALK_IN', 'PHONE', 'REFERRAL'));
ALTER TABLE leads ADD CONSTRAINT leads_status_values CHECK (status IN ('NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'));
ALTER TABLE lead_activities ADD CONSTRAINT lead_activities_type_values CHECK (type IN ('NOTE', 'CALL', 'EMAIL', 'STATUS_CHANGE', 'QUOTE_SENT', 'TRIAL_BOOKED', 'CONVERTED'));
ALTER TABLE quotes ADD CONSTRAINT quotes_status_values CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'));
ALTER TABLE employees ADD CONSTRAINT employees_department_values CHECK (department IN ('FRONT_DESK', 'BAR', 'MAINTENANCE', 'COACHING', 'MANAGEMENT'));
ALTER TABLE employees ADD CONSTRAINT employees_status_values CHECK (status IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE staff_shifts ADD CONSTRAINT staff_shifts_role_label_values CHECK (role_label IN ('BAR', 'FRONT_DESK', 'KITCHEN', 'OTHER'));
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_leave_type_values CHECK (leave_type IN ('CASUAL', 'SICK', 'PAID'));
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_values CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
ALTER TABLE notifications ADD CONSTRAINT notifications_type_values CHECK (type IN ('LOW_STOCK', 'MEMBERSHIP_EXPIRING', 'MEMBERSHIP_EXPIRED', 'NEW_LEAD', 'ONLINE_ORDER', 'LEAVE_REQUEST', 'LEAVE_DECIDED', 'KITCHEN_READY'));
