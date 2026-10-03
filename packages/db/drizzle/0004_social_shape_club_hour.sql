ALTER TABLE "court_occupancies" DROP CONSTRAINT "court_occupancies_shape";
--> statement-breakpoint
ALTER TABLE "court_occupancies" ADD CONSTRAINT "court_occupancies_shape" CHECK (
  "ends_at" > "starts_at" AND (
    ("kind" = 'BOOKING'
       AND "ends_at" - "starts_at" = interval '1 hour'
       AND extract(minute FROM ("starts_at" AT TIME ZONE 'UTC')) IN (0, 30)
       AND extract(second FROM ("starts_at" AT TIME ZONE 'UTC')) = 0)
    OR ("kind" = 'SOCIAL'
       AND "ends_at" - "starts_at" = interval '1 hour'
       AND extract(minute FROM ("starts_at" AT TIME ZONE 'UTC')) = 30
       AND extract(second FROM ("starts_at" AT TIME ZONE 'UTC')) = 0)
    OR "kind" = 'MAINTENANCE'
  )
);
