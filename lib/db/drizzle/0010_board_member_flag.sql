-- Task #59: Board member designation independent of role
-- Adds a board_member boolean to users and backfills existing admins/managers
-- to true so the existing Stripe approval flow keeps working.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "board_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint

UPDATE "users" SET "board_member" = true WHERE "role" IN ('admin', 'manager') AND "board_member" = false;
