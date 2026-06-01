-- Task #108: per-user opt-in/out for governance event emails (meeting
-- scheduled, agenda published, minutes adopted, public resolution adopted).
-- In-app notifications still post regardless; only the email send is gated.
ALTER TABLE "user_notification_preferences"
  ADD COLUMN IF NOT EXISTS "governance_email" integer NOT NULL DEFAULT 1;
