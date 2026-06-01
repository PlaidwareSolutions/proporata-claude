-- Task #121: OCR & auto-tag suggestions for the bulk historical-document
-- importer. Adds the OCR job queue, an extracted-text column on documents,
-- and the org-settings toggle + daily page cap.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "extracted_text" text;
--> statement-breakpoint

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "ocr_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "ocr_daily_page_cap" integer NOT NULL DEFAULT 1000;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_ocr_jobs" (
  "id" serial PRIMARY KEY,
  "storage_key" text NOT NULL UNIQUE,
  "file_name" text NOT NULL DEFAULT '',
  "content_type" text,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "suggestions" jsonb,
  "full_text" text,
  "page_count" integer NOT NULL DEFAULT 0,
  "enqueued_by" integer,
  "created_at" text NOT NULL,
  "started_at" text,
  "completed_at" text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_ocr_jobs_status_idx" ON "document_ocr_jobs" ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "documents_extracted_text_idx" ON "documents" USING GIN (to_tsvector('english', coalesce("extracted_text", '')));
