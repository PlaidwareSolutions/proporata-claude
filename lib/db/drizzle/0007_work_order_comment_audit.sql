ALTER TABLE "work_order_events" ADD COLUMN IF NOT EXISTS "edited_at" text;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD COLUMN IF NOT EXISTS "deleted_at" text;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD COLUMN IF NOT EXISTS "original_payload" jsonb;
