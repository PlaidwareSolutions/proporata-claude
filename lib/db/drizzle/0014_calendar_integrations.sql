-- Task #76: Calendar — financial & compliance integrations.

ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "owner_user_id" integer;
CREATE INDEX IF NOT EXISTS "calendar_events_owner_idx" ON "calendar_events" ("owner_user_id");
CREATE INDEX IF NOT EXISTS "calendar_events_source_ref_idx" ON "calendar_events" ("source_ref_type", "source_ref_id");

CREATE TABLE IF NOT EXISTS "assessment_schedules" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "frequency" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "due_day" integer NOT NULL DEFAULT 1,
  "start_date" text NOT NULL,
  "end_date" text,
  "active" boolean NOT NULL DEFAULT true,
  "reminder_leads_minutes" jsonb NOT NULL DEFAULT '[10080,1440]'::jsonb,
  "notes" text NOT NULL DEFAULT '',
  "calendar_event_id" integer,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "special_assessments" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "amount_cents" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "notice_date" text,
  "hearing_date" text,
  "hearing_location" text,
  "adoption_date" text,
  "billing_date" text,
  "due_date" text,
  "motion_id" integer,
  "notes" text NOT NULL DEFAULT '',
  "created_by_user_id" integer,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "collections_policies" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "reminder_days" integer NOT NULL DEFAULT 10,
  "late_notice_days" integer NOT NULL DEFAULT 30,
  "demand_letter_days" integer NOT NULL DEFAULT 60,
  "lien_days" integer NOT NULL DEFAULT 90,
  "attorney_days" integer NOT NULL DEFAULT 120,
  "active" boolean NOT NULL DEFAULT true,
  "updated_at" text
);
INSERT INTO "collections_policies" ("id") VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "budget_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "fiscal_year" integer NOT NULL UNIQUE,
  "draft_due_date" text,
  "review_meeting_date" text,
  "ratification_meeting_date" text,
  "publication_date" text,
  "reserve_study_refresh_date" text,
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "reserve_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'other',
  "estimated_cost_cents" integer NOT NULL DEFAULT 0,
  "funding_date" text,
  "bid_window_start" text,
  "bid_window_end" text,
  "scheduled_start" text,
  "scheduled_end" text,
  "status" text NOT NULL DEFAULT 'planned',
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "compliance_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "due_date" text NOT NULL,
  "recurrence" jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "owner_user_id" integer,
  "reminder_leads_minutes" jsonb NOT NULL DEFAULT '[43200,10080,1440]'::jsonb,
  "notes" text NOT NULL DEFAULT '',
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "violations" (
  "id" serial PRIMARY KEY NOT NULL,
  "unit_id" text NOT NULL REFERENCES "units"("id"),
  "owner_user_id" integer,
  "owner_name" text NOT NULL DEFAULT '',
  "category" text NOT NULL,
  "description" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "observed_at" text NOT NULL,
  "first_notice_date" text,
  "cure_deadline" text,
  "second_notice_date" text,
  "hearing_date" text,
  "resolved_at" text,
  "fine_cents" integer NOT NULL DEFAULT 0,
  "created_by_user_id" integer,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "violations_owner_idx" ON "violations" ("owner_user_id");
CREATE INDEX IF NOT EXISTS "violations_unit_idx" ON "violations" ("unit_id");

CREATE TABLE IF NOT EXISTS "hearings" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "ref_type" text,
  "ref_id" integer,
  "title" text NOT NULL,
  "scheduled_at" text NOT NULL,
  "location_text" text,
  "location_url" text,
  "notice_date" text,
  "status" text NOT NULL DEFAULT 'scheduled',
  "outcome" text,
  "created_by_user_id" integer,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "hearings_ref_idx" ON "hearings" ("ref_type", "ref_id");
