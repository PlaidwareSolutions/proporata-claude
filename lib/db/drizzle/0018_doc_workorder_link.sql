ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "work_order_id" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "documents_work_order_idx" ON "documents" ("work_order_id");
