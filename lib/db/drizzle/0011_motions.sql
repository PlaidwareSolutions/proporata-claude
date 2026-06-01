-- Task #62: Board Motions & Voting Engine
-- Generic motion object with configurable voting rules + audit trail.
-- Migrates the existing Stripe key-change flow onto motions and drops the old
-- stripe_config_change_requests / stripe_config_approvals tables.

CREATE TABLE IF NOT EXISTS "motions" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "body_hash" text,
  "voting_rule" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "outcome" text,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "opened_at" text,
  "closes_at" text,
  "resolved_at" text,
  "reminder_sent_at" text,
  "meeting_id" integer,
  "payload" jsonb
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "motion_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "motion_id" integer NOT NULL REFERENCES "motions"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "user_name" text NOT NULL DEFAULT '',
  "decision" text NOT NULL,
  "comment" text,
  "body_hash_at_vote" text,
  "created_at" text NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "motion_votes" ADD CONSTRAINT "motion_votes_motion_id_user_id_unique" UNIQUE ("motion_id", "user_id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "motion_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "motion_id" integer NOT NULL REFERENCES "motions"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "size" integer NOT NULL DEFAULT 0,
  "content_type" text,
  "storage_key" text NOT NULL,
  "uploaded_by_user_id" integer REFERENCES "users"("id"),
  "uploaded_by_name" text NOT NULL DEFAULT '',
  "uploaded_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "motions_status_idx" ON "motions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motions_kind_idx" ON "motions" ("kind");--> statement-breakpoint

-- Backfill: migrate any existing stripe_config_change_requests rows into motions.
DO $$
DECLARE
  has_old_table boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_config_change_requests'
  ) INTO has_old_table;

  IF has_old_table THEN
    -- Insert motions for every stripe_config_change_request, preserving the
    -- original id so existing FK-style references and UI links still resolve.
    INSERT INTO "motions" (
      "id", "kind", "title", "body", "voting_rule", "status", "outcome",
      "created_by_user_id", "created_by_name", "created_at", "opened_at",
      "closes_at", "resolved_at", "payload"
    )
    SELECT
      r.id,
      'stripe_config',
      'Stripe key change',
      COALESCE(r.reason, ''),
      '{"type":"unanimous"}'::jsonb,
      CASE r.status
        WHEN 'pending' THEN 'open'
        WHEN 'applied' THEN 'adopted'
        WHEN 'rejected' THEN 'rejected'
        WHEN 'cancelled' THEN 'withdrawn'
        ELSE 'open'
      END,
      CASE r.status
        WHEN 'applied' THEN 'adopted'
        WHEN 'rejected' THEN 'rejected'
        WHEN 'cancelled' THEN 'withdrawn'
        ELSE NULL
      END,
      r.proposed_by_user_id,
      r.proposed_by_name,
      r.created_at,
      r.created_at,
      NULL,
      r.resolved_at,
      jsonb_build_object(
        'secretKey', r.secret_key,
        'publishableKey', r.publishable_key,
        'webhookSecret', r.webhook_secret,
        'reason', r.reason
      )
    FROM "stripe_config_change_requests" r
    ON CONFLICT (id) DO NOTHING;

    -- Keep the motions sequence ahead of any backfilled ids.
    PERFORM setval(pg_get_serial_sequence('motions', 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM motions), 0), 1));
  END IF;
END $$;--> statement-breakpoint

DO $$
DECLARE
  has_old_appr boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_config_approvals'
  ) INTO has_old_appr;

  IF has_old_appr THEN
    INSERT INTO "motion_votes" (
      "motion_id", "user_id", "user_name", "decision", "created_at"
    )
    SELECT a.request_id, a.user_id, a.user_name, a.decision, a.created_at
    FROM "stripe_config_approvals" a
    ON CONFLICT ("motion_id", "user_id") DO NOTHING;
  END IF;
END $$;--> statement-breakpoint

-- Drop the legacy stripe-specific approval tables now that data has migrated.
DROP TABLE IF EXISTS "stripe_config_approvals";--> statement-breakpoint
DROP TABLE IF EXISTS "stripe_config_change_requests";
