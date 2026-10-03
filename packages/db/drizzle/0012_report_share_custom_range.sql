ALTER TABLE "report_shares" ADD COLUMN IF NOT EXISTS "custom_from" date;
--> statement-breakpoint
ALTER TABLE "report_shares" ADD COLUMN IF NOT EXISTS "custom_to" date;
--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_custom_range_chk" CHECK (("custom_from" IS NULL AND "custom_to" IS NULL) OR ("custom_from" IS NOT NULL AND "custom_to" IS NOT NULL AND "custom_to" >= "custom_from"));
