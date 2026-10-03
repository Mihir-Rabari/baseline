CREATE TABLE "member_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_by" uuid,
	"booking_id" uuid
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"member_code" varchar(16) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(255),
	"date_of_birth" date,
	"photo_key" varchar(255),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "members_member_code_unique" UNIQUE("member_code")
);
--> statement-breakpoint
CREATE TABLE "membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_reminders" (
	"membership_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_reminders_membership_id_kind_pk" PRIMARY KEY("membership_id","kind")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pending_plan_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"monthly_fee_paise" integer NOT NULL,
	"court_discount_pct" smallint DEFAULT 0 NOT NULL,
	"shop_discount_pct" smallint DEFAULT 0 NOT NULL,
	"bar_discount_pct" smallint DEFAULT 0 NOT NULL,
	"max_bookings_per_day" smallint DEFAULT 2 NOT NULL,
	"booking_horizon_days" smallint DEFAULT 7 NOT NULL,
	"min_age" smallint,
	"max_age" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_id" uuid NOT NULL,
	"kind" varchar(16) DEFAULT 'STANDARD' NOT NULL,
	"member_id" uuid,
	"guest_name" varchar(255),
	"guest_phone" varchar(20),
	"guest_email" varchar(255),
	"social_session_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"booking_date" date NOT NULL,
	"status" varchar(16) DEFAULT 'CONFIRMED' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_late" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"base_price_paise" integer NOT NULL,
	"discount_pct" smallint DEFAULT 0 NOT NULL,
	"price_paise" integer NOT NULL,
	"payment_status" varchar(16) DEFAULT 'UNPAID' NOT NULL,
	"channel" varchar(20) DEFAULT 'DESK' NOT NULL,
	"lead_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "court_occupancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" varchar(16) NOT NULL,
	"booking_id" uuid,
	"social_session_id" uuid,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_occupancies_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "court_occupancies_social_session_id_unique" UNIQUE("social_session_id")
);
--> statement-breakpoint
CREATE TABLE "court_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"base_rate_paise" integer NOT NULL,
	"social_fee_paise" integer NOT NULL,
	"trial_fee_paise" integer NOT NULL,
	"social_capacity" smallint DEFAULT 8 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "courts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_type_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "social_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" smallint NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_time" time NOT NULL,
	"ends_time" time NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name_snapshot" varchar(255) NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"discount_pct" smallint DEFAULT 0 NOT NULL,
	"line_total_paise" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(20) NOT NULL,
	"channel" varchar(12) NOT NULL,
	"member_id" uuid,
	"customer_name" varchar(255),
	"customer_phone" varchar(20),
	"fulfilment" varchar(12) DEFAULT 'COUNTER' NOT NULL,
	"delivery_address" text,
	"delivery_fee_paise" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'COMPLETED' NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"payment_status" varchar(12) DEFAULT 'UNPAID' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(24) NOT NULL,
	"description" text,
	"image_url" varchar(512),
	"price_paise" integer NOT NULL,
	"discountable" boolean DEFAULT true NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 5 NOT NULL,
	"low_stock_alerted_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" varchar(24) NOT NULL,
	"order_id" uuid,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bar_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(32) NOT NULL,
	"seats" smallint DEFAULT 4 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "bar_tables_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "kitchen_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tab_id" uuid NOT NULL,
	"station" varchar(16) DEFAULT 'KITCHEN' NOT NULL,
	"status" varchar(12) DEFAULT 'NEW' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"category" varchar(16) NOT NULL,
	"station" varchar(16) DEFAULT 'KITCHEN' NOT NULL,
	"price_paise" integer NOT NULL,
	"discountable" boolean DEFAULT true NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tab_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tab_id" uuid NOT NULL,
	"ticket_id" uuid,
	"menu_item_id" uuid NOT NULL,
	"name_snapshot" varchar(128) NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"discount_pct" smallint DEFAULT 0 NOT NULL,
	"line_total_paise" integer NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tab_number" integer NOT NULL,
	"member_id" uuid,
	"guest_name" varchar(255),
	"table_id" uuid,
	"status" varchar(12) DEFAULT 'OPEN' NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_by" uuid,
	"settled_at" timestamp with time zone,
	"subtotal_paise" integer,
	"discount_paise" integer,
	"total_paise" integer,
	"shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tabs_tab_number_unique" UNIQUE("tab_number")
);
--> statement-breakpoint
CREATE TABLE "business_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"contact_name" varchar(255),
	"email" varchar(255),
	"phone" varchar(20),
	"gstin" varchar(20),
	"billing_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" varchar(255) NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"line_total_paise" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(24) NOT NULL,
	"member_id" uuid,
	"business_client_id" uuid,
	"status" varchar(8) DEFAULT 'DRAFT' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"notes" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_id" uuid,
	"kind" varchar(8) DEFAULT 'PAYMENT' NOT NULL,
	"amount_paise" integer NOT NULL,
	"method" varchar(8) NOT NULL,
	"member_id" uuid,
	"received_by" uuid,
	"shift_id" uuid,
	"reference" varchar(128),
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"default_range" varchar(8) DEFAULT 'month' NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"body" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"source" varchar(20) NOT NULL,
	"interested_plan_id" uuid,
	"message" text,
	"status" varchar(12) DEFAULT 'NEW' NOT NULL,
	"assigned_to" uuid,
	"next_follow_up_at" timestamp with time zone,
	"lost_reason" text,
	"member_id" uuid,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"valid_until" date NOT NULL,
	"status" varchar(12) DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(20),
	"position" varchar(64) NOT NULL,
	"department" varchar(24) NOT NULL,
	"monthly_salary_paise" integer DEFAULT 0 NOT NULL,
	"hired_on" date NOT NULL,
	"status" varchar(12) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type" varchar(12) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"role_label" varchar(24) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"clock_in_at" timestamp with time zone,
	"clock_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(24) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"link" varchar(255),
	"data" jsonb,
	"dedupe_key" varchar(128),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "member_checkins" ADD CONSTRAINT "member_checkins_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_checkins" ADD CONSTRAINT "member_checkins_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_to_plan_id_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_reminders" ADD CONSTRAINT "membership_reminders_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_pending_plan_id_plans_id_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_social_session_id_social_sessions_id_fk" FOREIGN KEY ("social_session_id") REFERENCES "public"."social_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_social_session_id_social_sessions_id_fk" FOREIGN KEY ("social_session_id") REFERENCES "public"."social_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_court_type_id_court_types_id_fk" FOREIGN KEY ("court_type_id") REFERENCES "public"."court_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_sessions" ADD CONSTRAINT "social_sessions_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_tab_id_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."tabs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_tab_id_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."tabs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_ticket_id_kitchen_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."kitchen_tickets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_table_id_bar_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."bar_tables"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_client_id_business_clients_id_fk" FOREIGN KEY ("business_client_id") REFERENCES "public"."business_clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_interested_plan_id_plans_id_fk" FOREIGN KEY ("interested_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_member_checkins_member" ON "member_checkins" USING btree ("member_id","checked_in_at");
--> statement-breakpoint
CREATE INDEX "idx_members_phone" ON "members" USING btree ("phone");
--> statement-breakpoint
CREATE INDEX "idx_members_full_name" ON "members" USING btree ("full_name");
--> statement-breakpoint
CREATE INDEX "idx_members_email" ON "members" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "idx_membership_events_member" ON "membership_events" USING btree ("member_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memberships_one_active" ON "memberships" USING btree ("member_id") WHERE "memberships"."status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "idx_memberships_member" ON "memberships" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "idx_memberships_ends_on" ON "memberships" USING btree ("ends_on","status");
--> statement-breakpoint
CREATE INDEX "idx_bookings_court_start" ON "bookings" USING btree ("court_id","starts_at");
--> statement-breakpoint
CREATE INDEX "idx_bookings_member_date" ON "bookings" USING btree ("member_id","booking_date");
--> statement-breakpoint
CREATE INDEX "idx_bookings_date_status" ON "bookings" USING btree ("booking_date","status");
--> statement-breakpoint
CREATE INDEX "idx_bookings_guest_phone" ON "bookings" USING btree ("guest_phone");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bookings_social_member" ON "bookings" USING btree ("social_session_id","member_id") WHERE "bookings"."status" <> 'CANCELLED' AND "bookings"."member_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bookings_trial_phone" ON "bookings" USING btree ("guest_phone") WHERE "bookings"."kind" = 'TRIAL' AND "bookings"."status" <> 'CANCELLED';
--> statement-breakpoint
CREATE INDEX "idx_court_occupancies_court_start" ON "court_occupancies" USING btree ("court_id","starts_at");
--> statement-breakpoint
CREATE INDEX "idx_courts_type" ON "courts" USING btree ("court_type_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_social_sessions_court_start" ON "social_sessions" USING btree ("court_id","starts_at");
--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "idx_order_items_product" ON "order_items" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "idx_orders_member" ON "orders" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "idx_orders_created" ON "orders" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "idx_products_category" ON "products" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "idx_products_stock" ON "products" USING btree ("stock_qty");
--> statement-breakpoint
CREATE INDEX "idx_stock_movements_product" ON "stock_movements" USING btree ("product_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_kitchen_tickets_status" ON "kitchen_tickets" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "idx_menu_items_category" ON "menu_items" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "idx_tab_items_tab" ON "tab_items" USING btree ("tab_id");
--> statement-breakpoint
CREATE INDEX "idx_tab_items_ticket" ON "tab_items" USING btree ("ticket_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tabs_one_open_per_table" ON "tabs" USING btree ("table_id") WHERE "tabs"."status" = 'OPEN';
--> statement-breakpoint
CREATE INDEX "idx_tabs_status" ON "tabs" USING btree ("status","opened_at");
--> statement-breakpoint
CREATE INDEX "idx_tabs_settled_at" ON "tabs" USING btree ("settled_at");
--> statement-breakpoint
CREATE INDEX "idx_invoice_lines_invoice" ON "invoice_lines" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "idx_invoices_status_due" ON "invoices" USING btree ("status","due_date");
--> statement-breakpoint
CREATE INDEX "idx_invoices_member" ON "invoices" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "idx_invoices_client" ON "invoices" USING btree ("business_client_id");
--> statement-breakpoint
CREATE INDEX "idx_payments_paid_at" ON "payments" USING btree ("paid_at");
--> statement-breakpoint
CREATE INDEX "idx_payments_source_paid_at" ON "payments" USING btree ("source","paid_at");
--> statement-breakpoint
CREATE INDEX "idx_payments_method_paid_at" ON "payments" USING btree ("method","paid_at");
--> statement-breakpoint
CREATE INDEX "idx_payments_source_ref" ON "payments" USING btree ("source","source_id");
--> statement-breakpoint
CREATE INDEX "idx_lead_activities_lead" ON "lead_activities" USING btree ("lead_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_leads_status" ON "leads" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_leads_follow_up" ON "leads" USING btree ("next_follow_up_at");
--> statement-breakpoint
CREATE INDEX "idx_leads_phone" ON "leads" USING btree ("phone");
--> statement-breakpoint
CREATE INDEX "idx_quotes_lead" ON "quotes" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX "idx_employees_department" ON "employees" USING btree ("department");
--> statement-breakpoint
CREATE INDEX "idx_leave_requests_status" ON "leave_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_leave_requests_employee" ON "leave_requests" USING btree ("employee_id");
--> statement-breakpoint
CREATE INDEX "idx_staff_shifts_employee" ON "staff_shifts" USING btree ("employee_id","starts_at");
--> statement-breakpoint
CREATE INDEX "idx_staff_shifts_starts" ON "staff_shifts" USING btree ("starts_at");
--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","read_at","created_at");
