-- Task #61: Audit board-member flag changes
-- Records each toggle of users.board_member with timestamp and acting admin
-- so disputed Stripe-key approvals can be investigated after the fact.

CREATE TABLE IF NOT EXISTS "board_member_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "old_value" boolean NOT NULL,
  "new_value" boolean NOT NULL,
  "changed_by_user_id" integer,
  "changed_by_name" text DEFAULT '' NOT NULL,
  "changed_by_email" text DEFAULT '' NOT NULL,
  "created_at" text NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "board_member_audit"
    ADD CONSTRAINT "board_member_audit_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "board_member_audit"
    ADD CONSTRAINT "board_member_audit_changed_by_user_id_users_id_fk"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "board_member_audit_user_id_idx" ON "board_member_audit" ("user_id");
