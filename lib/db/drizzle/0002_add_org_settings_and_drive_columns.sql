CREATE TABLE IF NOT EXISTS "org_settings" (
        "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
        "drive_refresh_token" text,
        "drive_account_email" text,
        "drive_connected_at" text,
        "drive_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "storage_key" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "drive_file_id" text;
