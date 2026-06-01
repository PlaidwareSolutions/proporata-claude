-- Task #63: Board Resolutions Library
-- A resolution wraps a motion of kind `resolution` and adds: a year-scoped
-- HOA number assigned at adoption, supersede/rescind chains, and a stored
-- PDF snapshot path. Idempotent so post-merge re-runs are safe.

CREATE TABLE IF NOT EXISTS "resolutions" (
  "id" serial PRIMARY KEY NOT NULL,
  "motion_id" integer NOT NULL UNIQUE REFERENCES "motions"("id") ON DELETE CASCADE,
  "category" text NOT NULL DEFAULT 'other',
  "number" text,
  "number_year" integer,
  "number_seq" integer,
  "superseded_by_resolution_id" integer,
  "rescinded_by_motion_id" integer REFERENCES "motions"("id") ON DELETE SET NULL,
  "pdf_storage_key" text,
  "created_at" text NOT NULL,
  "adopted_at" text
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_superseded_by_fk"
    FOREIGN KEY ("superseded_by_resolution_id") REFERENCES "resolutions"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "resolutions_year_seq_unique"
  ON "resolutions" ("number_year", "number_seq")
  WHERE "number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resolutions_category_idx" ON "resolutions" ("category");
