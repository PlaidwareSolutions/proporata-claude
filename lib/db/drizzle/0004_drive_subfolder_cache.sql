ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "drive_subfolder_ids" jsonb;
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "drive_subfolder_ids" jsonb;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_last_sync_failures" integer NOT NULL DEFAULT 0;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_master_index_folder_id" text;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_sync_in_progress" boolean NOT NULL DEFAULT false;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_sync_progress_done" integer NOT NULL DEFAULT 0;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_sync_progress_total" integer NOT NULL DEFAULT 0;
