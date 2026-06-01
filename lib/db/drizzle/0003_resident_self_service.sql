ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "owner_mailing_address" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "owner_emergency_name" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "owner_emergency_phone" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "tenant_emergency_name" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "tenant_emergency_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "work_orders_in_app" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "work_orders_email" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "announcements_in_app" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "announcements_email" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "billing_in_app" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "billing_email" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "acc_in_app" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "acc_email" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_change_tokens" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "new_email" text NOT NULL,
        "token_hash" text NOT NULL UNIQUE,
        "expires_at" text NOT NULL,
        "consumed_at" text,
        "created_at" text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_audit" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "unit_id" text,
        "action" text NOT NULL,
        "field" text NOT NULL,
        "old_value" text,
        "new_value" text,
        "created_at" text NOT NULL
);
