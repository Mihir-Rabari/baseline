ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "leave_allowance_days" smallint DEFAULT 24 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "suggested_unpaid_leave_days" smallint DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"requested_shift_id" uuid,
	"proposer_employee_id" uuid NOT NULL,
	"target_employee_id" uuid NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"note" varchar(500),
	"responded_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_swaps_distinct_people" CHECK ("proposer_employee_id" <> "target_employee_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_shift_id_staff_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."staff_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requested_shift_id_staff_shifts_id_fk" FOREIGN KEY ("requested_shift_id") REFERENCES "public"."staff_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_proposer_employee_id_employees_id_fk" FOREIGN KEY ("proposer_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_target_employee_id_employees_id_fk" FOREIGN KEY ("target_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shift_swaps_status" ON "shift_swaps" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shift_swaps_proposer" ON "shift_swaps" USING btree ("proposer_employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shift_swaps_target" ON "shift_swaps" USING btree ("target_employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_shift_swaps_open_shift" ON "shift_swaps" USING btree ("shift_id") WHERE "shift_swaps"."status" in ('PENDING', 'ACCEPTED');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_shift_swaps_open_requested" ON "shift_swaps" USING btree ("requested_shift_id") WHERE "shift_swaps"."status" in ('PENDING', 'ACCEPTED');
