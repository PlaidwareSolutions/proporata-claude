-- Task #146: org-wide welcome-tour version. Admins bump
-- `organization_settings.current_tour_version` after a major release so every
-- user whose `user_onboarding.tour_version_seen` is below the new number
-- sees the welcome tour again on next load. The server stamps each user's
-- seen version when they dismiss the tour, so it never force-replays.

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "current_tour_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint

ALTER TABLE "user_onboarding"
  ADD COLUMN IF NOT EXISTS "tour_version_seen" integer;
--> statement-breakpoint

-- Backfill: existing users who already completed the welcome tour before this
-- feature shipped should NOT be re-prompted just because the column defaults
-- to NULL while the org-wide version defaults to 1. Mark them as having seen
-- v1; only an explicit admin bump (>= v2) should re-open the tour for them.
UPDATE "user_onboarding"
   SET "tour_version_seen" = 1
 WHERE "tour_completed" = true
   AND "tour_version_seen" IS NULL;
