-- Task #120: Historical document surfaces — building systems, insurance
-- history, and vendor file room. Adds first-class records and links so per-
-- system, per-policy-year, and per-vendor history is queryable rather than
-- scattered across loose documents.

-- ── Building systems ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "building_systems" (
  "id" serial PRIMARY KEY,
  "building" integer NOT NULL REFERENCES "buildings"("num"),
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "installed_on" text,
  "warranty_expires_on" text,
  "manufacturer" text,
  "model" text,
  "serial_no" text,
  "status" text NOT NULL DEFAULT 'good',
  "retired_on" text,
  "notes" text,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "building_systems_building_idx" ON "building_systems" ("building");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "building_system_documents" (
  "id" serial PRIMARY KEY,
  "system_id" integer NOT NULL REFERENCES "building_systems"("id") ON DELETE CASCADE,
  "document_id" text NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'other',
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "building_system_documents_system_idx" ON "building_system_documents" ("system_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "building_system_inspections" (
  "id" serial PRIMARY KEY,
  "system_id" integer NOT NULL REFERENCES "building_systems"("id") ON DELETE CASCADE,
  "inspected_on" text NOT NULL,
  "inspector" text,
  "summary" text,
  "document_id" text REFERENCES "documents"("id") ON DELETE SET NULL,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "building_system_inspections_system_idx" ON "building_system_inspections" ("system_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "building_system_repairs" (
  "id" serial PRIMARY KEY,
  "system_id" integer NOT NULL REFERENCES "building_systems"("id") ON DELETE CASCADE,
  "work_order_id" text NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "created_at" text NOT NULL,
  UNIQUE ("system_id", "work_order_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "building_system_repairs_system_idx" ON "building_system_repairs" ("system_id");--> statement-breakpoint

-- ── Insurance history ───────────────────────────────────────────────────
ALTER TABLE "insurance_policies" ADD COLUMN IF NOT EXISTS "effective_from" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_policy_history" (
  "id" serial PRIMARY KEY,
  "building" integer NOT NULL REFERENCES "buildings"("num"),
  "carrier" text NOT NULL,
  "policy_no" text NOT NULL,
  "coverage" integer NOT NULL,
  "premium" integer NOT NULL,
  "effective_from" text NOT NULL,
  "effective_to" text NOT NULL,
  "ended_reason" text,
  "notes" text,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "insurance_policy_history_building_idx" ON "insurance_policy_history" ("building");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_policy_history_documents" (
  "id" serial PRIMARY KEY,
  "history_id" integer NOT NULL REFERENCES "insurance_policy_history"("id") ON DELETE CASCADE,
  "document_id" text NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'other',
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "insurance_policy_history_documents_history_idx" ON "insurance_policy_history_documents" ("history_id");--> statement-breakpoint

-- ── Documents.vendor_id (vendor file room tagging) ──────────────────────
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "vendor_id" integer REFERENCES "vendors"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "documents_vendor_idx" ON "documents" ("vendor_id");
