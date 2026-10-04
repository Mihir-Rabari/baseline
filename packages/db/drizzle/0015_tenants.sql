CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(12) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"kind" varchar(8) DEFAULT 'CUSTOM' NOT NULL,
	"status" varchar(10) DEFAULT 'PENDING' NOT NULL,
	"verification_token" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_branding" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"logo_url" varchar(512),
	"primary_color" varchar(7),
	"secondary_color" varchar(7),
	"accent_color" varchar(7),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_domains_domain" ON "tenant_domains" USING btree (lower("domain"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_domains_tenant" ON "tenant_domains" USING btree ("tenant_id");
--> statement-breakpoint
INSERT INTO "tenants" ("id", "slug", "name") VALUES ('00000000-0000-4000-8000-000000000001', 'default', 'Default club')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "tenant_branding" ("tenant_id") VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT ("tenant_id") DO NOTHING;
