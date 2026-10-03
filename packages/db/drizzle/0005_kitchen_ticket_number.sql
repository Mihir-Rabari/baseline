ALTER TABLE "kitchen_tickets" ADD COLUMN "ticket_number" integer GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_ticket_number_unique" UNIQUE ("ticket_number");
