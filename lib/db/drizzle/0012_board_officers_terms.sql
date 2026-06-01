-- Task #67: Board officers and terms
-- Adds officer title and term dates to users and a board_history audit table
-- recording every change to board membership, officer title, and term dates.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "officer_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "term_start" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "term_end" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "board_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "actor_user_id" integer,
  "actor_name" text NOT NULL DEFAULT '',
  "action" text NOT NULL,
  "old_board_member" boolean,
  "new_board_member" boolean,
  "old_officer_title" text,
  "new_officer_title" text,
  "old_term_start" text,
  "new_term_start" text,
  "old_term_end" text,
  "new_term_end" text,
  "created_at" text NOT NULL
);
