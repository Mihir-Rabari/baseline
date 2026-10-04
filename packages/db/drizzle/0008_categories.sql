CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(16) NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(48) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_categories_scope_code" ON "categories" USING btree ("scope","code");
--> statement-breakpoint
INSERT INTO "categories" ("scope", "code", "name", "sort_order") VALUES
	('PRODUCT', 'RACKET', 'Rackets', 1),
	('PRODUCT', 'BALL', 'Balls', 2),
	('PRODUCT', 'SHOE', 'Shoes', 3),
	('PRODUCT', 'ACCESSORY', 'Accessories', 4),
	('PRODUCT', 'APPAREL', 'Apparel', 5),
	('MENU', 'DRINK', 'Drinks', 1),
	('MENU', 'FOOD', 'Food', 2),
	('MENU', 'SNACK', 'Snacks', 3)
ON CONFLICT ("scope", "code") DO NOTHING;
