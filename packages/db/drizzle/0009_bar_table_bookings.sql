CREATE TABLE IF NOT EXISTS "bar_table_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"guest_name" varchar(255) NOT NULL,
	"member_id" uuid,
	"party_size" smallint DEFAULT 2 NOT NULL,
	"notes" varchar(500),
	"status" varchar(12) DEFAULT 'BOOKED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bar_table_bookings_range_chk" CHECK ("bar_table_bookings"."ends_at" > "bar_table_bookings"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "bar_table_bookings" ADD CONSTRAINT "bar_table_bookings_table_id_bar_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."bar_tables"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bar_table_bookings" ADD CONSTRAINT "bar_table_bookings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bar_table_bookings" ADD CONSTRAINT "bar_table_bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bar_table_bookings_table_time" ON "bar_table_bookings" USING btree ("table_id","starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bar_table_bookings_starts" ON "bar_table_bookings" USING btree ("starts_at");
