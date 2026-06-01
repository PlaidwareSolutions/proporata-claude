-- Task #65: Board Meetings, Agendas & Minutes.
-- Hand-authored to match the existing IF NOT EXISTS pattern. Re-applying
-- against a database already synced via `drizzle-kit push` is a no-op.

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "meeting_notice_open_days" integer NOT NULL DEFAULT 3;
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "meeting_notice_executive_days" integer NOT NULL DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "meeting_notice_annual_days" integer NOT NULL DEFAULT 30;
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "meeting_quorum_mode" text NOT NULL DEFAULT 'majority';
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "meeting_quorum_percent_bp" integer NOT NULL DEFAULT 5000;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ical_feed_token" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meetings" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL DEFAULT 'open',
  "title" text NOT NULL,
  "scheduled_at" text NOT NULL,
  "duration_minutes" integer NOT NULL DEFAULT 60,
  "location_physical" text,
  "location_video_link" text,
  "notice_text" text NOT NULL DEFAULT '',
  "notice_posted_at" text,
  "status" text NOT NULL DEFAULT 'scheduled',
  "started_at" text,
  "adjourned_at" text,
  "agenda_packet_storage_key" text,
  "agenda_packet_generated_at" text,
  "minutes_content" text NOT NULL DEFAULT '',
  "minutes_status" text NOT NULL DEFAULT 'none',
  "minutes_adoption_motion_id" integer,
  "minutes_adopted_at" text,
  "minutes_storage_key" text,
  "quorum_mode" text,
  "quorum_percent_bp" integer,
  "created_by_user_id" integer,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meeting_agenda_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "meeting_id" integer NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "kind" text NOT NULL DEFAULT 'discussion',
  "title" text NOT NULL,
  "notes" text,
  "motion_id" integer,
  "presenter" text,
  "item_minutes" text NOT NULL DEFAULT ''
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meeting_id_meetings_id_fk"
    FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_motion_id_motions_id_fk"
    FOREIGN KEY ("motion_id") REFERENCES "public"."motions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meeting_attendance" (
  "id" serial PRIMARY KEY NOT NULL,
  "meeting_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "user_name" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'absent',
  "is_board_member" boolean NOT NULL DEFAULT false,
  "recorded_at" text NOT NULL,
  CONSTRAINT "meeting_attendance_meeting_id_user_id_unique" UNIQUE("meeting_id","user_id")
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_meetings_id_fk"
    FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
