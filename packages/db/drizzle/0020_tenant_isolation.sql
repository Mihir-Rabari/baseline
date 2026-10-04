-- Multi-tenant data isolation (#69 piece B).
--
-- 1. Every club-owned table gets a tenant_id (existing rows belong to the default club).
-- 2. Names/codes a club picks become unique per club instead of globally.
-- 3. Row-level security confines the `baseline_tenant` role to the club named by the transaction-local
--    setting `app.tenant_id`. The API switches to that role for every request (see tenant-scope.ts), so a
--    forgotten WHERE clause can never reach another club's rows. Seeds, migrations and the platform
--    operator run as the owner, which bypasses row-level security.
CREATE OR REPLACE FUNCTION app_tenant_current() RETURNS uuid LANGUAGE sql STABLE AS $$
	SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_tenant_default() RETURNS uuid LANGUAGE sql STABLE AS $$
	SELECT coalesce(app_tenant_current(), '00000000-0000-4000-8000-000000000001'::uuid)
$$;
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bar_table_bookings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_table_bookings" ADD CONSTRAINT "bar_table_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bar_tables" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_tables" ADD CONSTRAINT "bar_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_clients" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_clients" ADD CONSTRAINT "business_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "court_types" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "court_types" ADD CONSTRAINT "court_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "group_policies" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "group_policies" ADD CONSTRAINT "group_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_checkins" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_checkins" ADD CONSTRAINT "member_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_reminders" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "membership_reminders" ADD CONSTRAINT "membership_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "policy_statements" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "policy_statements" ADD CONSTRAINT "policy_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_shares" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "role_policies" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "role_policies" ADD CONSTRAINT "role_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_sessions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "social_sessions" ADD CONSTRAINT "social_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_windows" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "social_windows" ADD CONSTRAINT "social_windows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "system_audit_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_audit_logs" ADD CONSTRAINT "system_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tab_items" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tabs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_groups" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_policies" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_policies" ADD CONSTRAINT "user_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_tenant_email" ON "users" USING btree ("tenant_id","email");
--> statement-breakpoint
ALTER TABLE "bar_tables" DROP CONSTRAINT IF EXISTS "bar_tables_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bar_tables_tenant_name" ON "bar_tables" USING btree ("tenant_id","name");
--> statement-breakpoint
ALTER TABLE "court_types" DROP CONSTRAINT IF EXISTS "court_types_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_court_types_tenant_code" ON "court_types" USING btree ("tenant_id","code");
--> statement-breakpoint
ALTER TABLE "courts" DROP CONSTRAINT IF EXISTS "courts_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_courts_tenant_name" ON "courts" USING btree ("tenant_id","name");
--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "plans_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_plans_tenant_code" ON "plans" USING btree ("tenant_id","code");
--> statement-breakpoint
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_month_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_runs_tenant_month" ON "payroll_runs" USING btree ("tenant_id","month");
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_dedupe_key_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_tenant_dedupe" ON "notifications" USING btree ("tenant_id","dedupe_key");
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_products_tenant_sku" ON "products" USING btree ("tenant_id","sku");
--> statement-breakpoint
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_policies_tenant_name" ON "policies" USING btree ("tenant_id","name");
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_roles_tenant_name" ON "roles" USING btree ("tenant_id","name");
--> statement-breakpoint
ALTER TABLE "groups" DROP CONSTRAINT IF EXISTS "groups_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_groups_tenant_name" ON "groups" USING btree ("tenant_id","name");
--> statement-breakpoint
DROP INDEX IF EXISTS "uq_categories_scope_code";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_categories_tenant_scope_code" ON "categories" USING btree ("tenant_id","scope","code");
--> statement-breakpoint
ALTER TABLE "system_settings" DROP CONSTRAINT IF EXISTS "system_settings_pkey";
--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_key_pk" PRIMARY KEY ("tenant_id","key");
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT app_tenant_default() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseline_tenant') THEN
		CREATE ROLE baseline_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
	END IF;
END $$;
--> statement-breakpoint
GRANT baseline_tenant TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO baseline_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO baseline_tenant;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO baseline_tenant;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baseline_tenant;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO baseline_tenant;
--> statement-breakpoint
ALTER TABLE "agent_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "agent_actions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "agent_actions" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "agent_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "agent_conversations";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "agent_conversations" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "agent_messages";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "agent_messages" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "bar_table_bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bar_table_bookings";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bar_table_bookings" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "bar_tables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bar_tables";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bar_tables" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bookings";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bookings" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "business_clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "business_clients";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "business_clients" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "categories";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "categories" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "court_occupancies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "court_occupancies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "court_occupancies" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "court_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "court_types";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "court_types" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "courts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "courts";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "courts" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "employee_bank_details";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_bank_details" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "employees";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employees" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "group_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "group_policies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "group_policies" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "groups";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "groups" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "invoice_lines";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_lines" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "invoices";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoices" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "kitchen_tickets";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "kitchen_tickets" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "lead_activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "lead_activities";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "lead_activities" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "leads";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "leads" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "leave_requests";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "leave_requests" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "member_checkins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "member_checkins";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "member_checkins" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "members";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "members" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "membership_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "membership_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "membership_events" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "membership_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "membership_reminders";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "membership_reminders" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "memberships";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "memberships" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "menu_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_items" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notifications";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "order_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_items" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "orders";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "orders" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "password_setup_tokens";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "password_setup_tokens" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payments" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payroll_runs";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_runs" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payslips";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payslips" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "plans";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "plans" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "policies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policies" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "policy_statements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "policy_statements";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policy_statements" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "products";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "products" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "quotes";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "quotes" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "report_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "report_shares";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_shares" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "role_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "role_policies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_policies" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "roles" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "sessions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sessions" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "social_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "social_sessions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "social_sessions" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "social_windows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "social_windows";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "social_windows" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "staff_shifts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "staff_shifts";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "staff_shifts" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "stock_movements";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_movements" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "system_audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "system_audit_logs";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "system_audit_logs" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "system_settings";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "system_settings" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "tab_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tab_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tab_items" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "tabs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tabs";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tabs" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "user_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "user_groups";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "user_groups" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "user_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "user_policies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "user_policies" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "user_roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "user_roles" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "users";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "users" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_domains";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_domains" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "tenant_branding" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_branding";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_branding" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "employee_documents";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_documents" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "shift_swaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "shift_swaps";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "shift_swaps" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payment_intents";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_intents" AS PERMISSIVE FOR ALL TO baseline_tenant USING (tenant_id = app_tenant_current()) WITH CHECK (tenant_id = app_tenant_current());
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenants";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenants" AS PERMISSIVE FOR SELECT TO baseline_tenant USING (id = app_tenant_current());
