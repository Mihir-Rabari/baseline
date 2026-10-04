CREATE TABLE IF NOT EXISTS "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"method" varchar(8) NOT NULL,
	"amount_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"court_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"base_price_paise" integer NOT NULL,
	"discount_pct" smallint DEFAULT 0 NOT NULL,
	"guest_name" varchar(255) NOT NULL,
	"guest_phone" varchar(20) NOT NULL,
	"guest_email" varchar(255),
	"occupancy_id" uuid,
	"booking_id" uuid,
	"reference" varchar(128),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_occupancy_id_court_occupancies_id_fk" FOREIGN KEY ("occupancy_id") REFERENCES "public"."court_occupancies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_amount_positive" CHECK ("amount_paise" > 0 AND "amount_paise" <= "total_paise");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_intents_status_expiry" ON "payment_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_intents_reference" ON "payment_intents" USING btree ("reference") WHERE "payment_intents"."reference" IS NOT NULL;
