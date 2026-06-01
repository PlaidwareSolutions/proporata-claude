ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "drive_folder_id" text;
--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "drive_shared_folder_id" text;
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "drive_folder_id" text;
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_root_folder_id" text;
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_last_sync_at" text;
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "drive_last_sync_count" integer;
