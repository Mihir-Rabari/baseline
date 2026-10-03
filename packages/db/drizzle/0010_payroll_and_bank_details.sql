CREATE TABLE IF NOT EXISTS "employee_bank_details" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"account_holder" varchar(128) NOT NULL,
	"account_number_enc" text NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"ifsc" varchar(11) NOT NULL,
	"bank_name" varchar(64),
	"upi_id" varchar(64),
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" varchar(7) NOT NULL,
	"status" varchar(10) DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payroll_runs_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name" varchar(255) NOT NULL,
	"position" varchar(64) NOT NULL,
	"department" varchar(24) NOT NULL,
	"monthly_salary_paise" integer NOT NULL,
	"days_in_month" smallint NOT NULL,
	"payable_days" smallint NOT NULL,
	"base_paise" integer NOT NULL,
	"unpaid_leave_days" smallint DEFAULT 0 NOT NULL,
	"leave_deduction_paise" integer DEFAULT 0 NOT NULL,
	"bonus_paise" integer DEFAULT 0 NOT NULL,
	"other_deduction_paise" integer DEFAULT 0 NOT NULL,
	"net_paise" integer NOT NULL,
	"approved_leave_days" smallint DEFAULT 0 NOT NULL,
	"shifts_scheduled" smallint DEFAULT 0 NOT NULL,
	"shifts_worked" smallint DEFAULT 0 NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_status" ON "payroll_runs" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payslips_run_employee" ON "payslips" USING btree ("run_id","employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payslips_employee" ON "payslips" USING btree ("employee_id");
