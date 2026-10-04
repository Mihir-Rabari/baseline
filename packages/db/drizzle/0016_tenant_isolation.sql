-- Multi-tenant data isolation (#69). Every club-owned table gets tenant_id and a row level security policy.
-- The request path runs as the NOLOGIN role baseline_app with app.tenant_id set, so the database itself
-- refuses to show or change another club's rows. Seeds, jobs and fixtures keep using the owner connection
-- and land in the default tenant.

CREATE OR REPLACE FUNCTION app_tenant_default() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_tenant_strict() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseline_app') THEN CREATE ROLE baseline_app NOLOGIN; END IF;
END $$;
--> statement-breakpoint
GRANT baseline_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO baseline_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bar_table_bookings', 'bar_tables', 'bookings', 'business_clients', 'categories', 'court_occupancies', 'court_types', 'courts', 'employee_bank_details', 'employees', 'invoice_lines', 'invoices', 'kitchen_tickets', 'lead_activities', 'leads', 'leave_requests', 'member_checkins', 'members', 'membership_events', 'membership_reminders', 'memberships', 'menu_items', 'notifications', 'order_items', 'orders', 'password_setup_tokens', 'payments', 'payroll_runs', 'payslips', 'plans', 'products', 'quotes', 'report_shares', 'sessions', 'social_sessions', 'social_windows', 'staff_shifts', 'stock_movements', 'system_audit_logs', 'system_settings', 'tab_items', 'tabs', 'tenant_branding', 'tenant_domains', 'user_groups', 'user_policies', 'user_roles', 'users'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT app_tenant_default()', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT app_tenant_default()', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', t)::regclass AND contype = 'f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = format('public.%I', t)::regclass AND attname = 'tenant_id')]) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id)', t, t || '_tenant_id_fk');
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', 'idx_' || t || '_tenant', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO baseline_app USING (tenant_id = app_tenant_strict()) WITH CHECK (tenant_id = app_tenant_strict())', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO baseline_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON tenants FROM baseline_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO baseline_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baseline_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO baseline_app;
--> statement-breakpoint
-- Uniqueness becomes per club (same constraint names, so existing error handling keeps working).
ALTER TABLE bar_tables DROP CONSTRAINT IF EXISTS bar_tables_name_unique;
--> statement-breakpoint
ALTER TABLE bar_tables ADD CONSTRAINT bar_tables_name_unique UNIQUE (tenant_id, name);
--> statement-breakpoint
ALTER TABLE court_types DROP CONSTRAINT IF EXISTS court_types_code_unique;
--> statement-breakpoint
ALTER TABLE court_types ADD CONSTRAINT court_types_code_unique UNIQUE (tenant_id, code);
--> statement-breakpoint
ALTER TABLE courts DROP CONSTRAINT IF EXISTS courts_name_unique;
--> statement-breakpoint
ALTER TABLE courts ADD CONSTRAINT courts_name_unique UNIQUE (tenant_id, name);
--> statement-breakpoint
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_code_unique;
--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_code_unique UNIQUE (tenant_id, code);
--> statement-breakpoint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_unique;
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_sku_unique UNIQUE (tenant_id, sku);
--> statement-breakpoint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (tenant_id, email);
--> statement-breakpoint
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_month_unique;
--> statement-breakpoint
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_month_unique UNIQUE (tenant_id, month);
--> statement-breakpoint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_dedupe_key_unique;
--> statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_dedupe_key_unique UNIQUE (tenant_id, dedupe_key);
--> statement-breakpoint
DROP INDEX IF EXISTS uq_categories_scope_code;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_categories_scope_code ON categories (tenant_id, scope, code);
--> statement-breakpoint
DROP INDEX IF EXISTS uq_bookings_trial_phone;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_bookings_trial_phone ON bookings (tenant_id, guest_phone) WHERE (kind = 'TRIAL' AND status <> 'CANCELLED');
--> statement-breakpoint
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_pkey;
--> statement-breakpoint
ALTER TABLE system_settings ADD CONSTRAINT system_settings_pkey PRIMARY KEY (tenant_id, key);
