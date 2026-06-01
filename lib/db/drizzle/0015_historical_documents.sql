-- Task #119: Historical documents foundation.
-- Adds metadata for historical documents, a document import-batch table for
-- bulk-uploaded files (with a 24-hour undo window), and historical fields on
-- work orders so past completed jobs can be logged without polluting current
-- operational metrics.

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "document_date" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_historical" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'original';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_import_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "label" text,
  "status" text NOT NULL DEFAULT 'committed',
  "file_count" integer NOT NULL DEFAULT 0,
  "default_category" text,
  "default_building" integer,
  "default_unit" text,
  "default_source" text NOT NULL DEFAULT 'imported',
  "default_is_historical" boolean NOT NULL DEFAULT true,
  "created_by" integer,
  "created_by_name" text,
  "created_at" text NOT NULL,
  "undone_at" text,
  "undone_by" integer,
  "undone_by_name" text,
  "notes" text
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "documents_import_batch_idx" ON "documents" ("import_batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_is_historical_idx" ON "documents" ("is_historical");--> statement-breakpoint

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "historical" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "completed_on" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "actual_cost" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "historical_vendor_name" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "historical_notes" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "work_orders_historical_idx" ON "work_orders" ("historical");
