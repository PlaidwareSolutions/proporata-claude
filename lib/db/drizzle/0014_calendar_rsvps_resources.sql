-- Task #94: RSVPs and bookable resources for the calendar
-- Adds resource_id/capacity to calendar_events, plus calendar_resources
-- and calendar_event_rsvps tables. Idempotent so post-merge re-runs are safe.

ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "resource_id" integer;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "capacity" integer;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_resources" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL UNIQUE,
  "description" text NOT NULL DEFAULT '',
  "capacity" integer,
  "active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_event_rsvps" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "occurrence_key" text NOT NULL DEFAULT '',
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_name" text NOT NULL DEFAULT '',
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "calendar_event_rsvps_unique" UNIQUE ("event_id", "occurrence_key", "user_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "calendar_event_rsvps_event_idx"
  ON "calendar_event_rsvps" ("event_id", "occurrence_key");--> statement-breakpoint

-- Foreign key from calendar_events.resource_id → calendar_resources.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_resource_fk'
  ) THEN
    ALTER TABLE "calendar_events"
      ADD CONSTRAINT "calendar_events_resource_fk"
      FOREIGN KEY ("resource_id") REFERENCES "calendar_resources"("id") ON DELETE SET NULL;
  END IF;
END $$;--> statement-breakpoint

-- Seed three default resources (idempotent on name).
INSERT INTO "calendar_resources" ("name", "description", "capacity", "active", "sort_order", "created_at")
VALUES
  ('Clubhouse',  'Main clubhouse / community room',  60,   true, 1, NOW()::text),
  ('Pool Deck',  'Pool deck and pavilion',           40,   true, 2, NOW()::text),
  ('Grill',      'Outdoor grill station',            12,   true, 3, NOW()::text)
ON CONFLICT ("name") DO NOTHING;
