ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "pinned" integer NOT NULL DEFAULT 0;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "updated_by" text;
