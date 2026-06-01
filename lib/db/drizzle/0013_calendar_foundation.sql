-- Task #74: Calendar foundation
-- Unified calendar engine: events, sub-calendars, recurrence, reminders,
-- attachments, audit, per-user prefs/iCal token, and external feeds.

CREATE TABLE IF NOT EXISTS "calendar_sub_calendars" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#3245FF',
  "description" text NOT NULL DEFAULT '',
  "editor_roles" jsonb NOT NULL,
  "viewer_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_public" boolean NOT NULL DEFAULT false,
  "is_external" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "sub_calendar_id" integer NOT NULL REFERENCES "calendar_sub_calendars"("id"),
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "all_day" boolean NOT NULL DEFAULT false,
  "location_text" text,
  "location_url" text,
  "recurrence" jsonb,
  "exceptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "overrides" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source" text,
  "source_ref_type" text,
  "source_ref_id" text,
  "external_uid" text,
  "cancelled" boolean NOT NULL DEFAULT false,
  "created_by_user_id" integer,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "calendar_events_sub_idx" ON "calendar_events" ("sub_calendar_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_starts_idx" ON "calendar_events" ("starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_external_uid_idx" ON "calendar_events" ("external_uid");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_event_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "size" integer NOT NULL DEFAULT 0,
  "content_type" text,
  "storage_key" text NOT NULL,
  "uploaded_by_user_id" integer,
  "uploaded_by_name" text NOT NULL DEFAULT '',
  "uploaded_at" text NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_event_reminders" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "instance_starts_at" text NOT NULL,
  "lead_minutes" integer NOT NULL,
  "channel_in_app" boolean NOT NULL DEFAULT true,
  "channel_email" boolean NOT NULL DEFAULT true,
  "channel_sms" boolean NOT NULL DEFAULT false,
  "user_id" integer,
  "dispatched_at" text,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "calendar_event_reminders_due_idx"
  ON "calendar_event_reminders" ("dispatched_at", "instance_starts_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_event_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL,
  "action" text NOT NULL,
  "actor_user_id" integer,
  "actor_name" text NOT NULL DEFAULT '',
  "diff" jsonb,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_user_prefs" (
  "user_id" integer PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "visible_sub_calendars" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "default_view" text NOT NULL DEFAULT 'month',
  "ical_token" text UNIQUE,
  "ical_token_created_at" text,
  "updated_at" text NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_external_feeds" (
  "id" serial PRIMARY KEY NOT NULL,
  "sub_calendar_id" integer NOT NULL REFERENCES "calendar_sub_calendars"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_fetched_at" text,
  "last_error" text,
  "last_event_count" integer NOT NULL DEFAULT 0,
  "created_by_user_id" integer,
  "created_at" text NOT NULL
);--> statement-breakpoint

-- Seed the eight default sub-calendars (idempotent on slug).
INSERT INTO "calendar_sub_calendars"
  ("slug", "name", "color", "description", "editor_roles", "viewer_roles", "is_public", "is_external", "sort_order")
VALUES
  ('board',       'Board',       '#3245FF', 'Board meetings, motions, executive sessions',     '["admin","manager","board"]'::jsonb, '[]'::jsonb,                  false, false, 1),
  ('committees',  'Committees',  '#7B3FE4', 'Committee meetings (ACC, finance, social)',       '["admin","manager","board"]'::jsonb, '[]'::jsonb,                  false, false, 2),
  ('operations',  'Operations',  '#0E8A6B', 'Work orders, inspections, vendor scheduling',     '["admin","manager"]'::jsonb,         '[]'::jsonb,                  false, false, 3),
  ('financial',   'Financial',   '#A66C0E', 'Dues, billing cycles, audit deadlines',           '["admin","manager"]'::jsonb,         '["admin","manager","board"]'::jsonb, false, false, 4),
  ('community',   'Community',   '#0EA5E9', 'Resident events, social, holidays',               '["admin","manager","board"]'::jsonb, '[]'::jsonb,                  true,  false, 5),
  ('amenities',   'Amenities',   '#DB2777', 'Amenity bookings & reservations',                 '["admin","manager"]'::jsonb,         '[]'::jsonb,                  false, false, 6),
  ('compliance',  'Compliance',  '#B8264C', 'ACC deadlines, violation hearings, insurance',    '["admin","manager"]'::jsonb,         '["admin","manager","board"]'::jsonb, false, false, 7),
  ('external',    'External',    '#64748B', 'Subscribed external calendars (city holidays)',   '["admin"]'::jsonb,                   '[]'::jsonb,                  false, true,  8)
ON CONFLICT ("slug") DO NOTHING;
