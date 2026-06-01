-- Multi-vendor bid requests (Task #55).
-- This migration is hand-authored to match the existing 0002–0007 pattern in
-- this repo. The live database has already been synced via `drizzle-kit push`,
-- so every statement is wrapped in IF NOT EXISTS / IF NOT EXISTS ... DO NOTHING
-- so re-applying against an already-migrated database is a no-op.

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "source_bid_id" integer;
--> statement-breakpoint

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "bid_min_quotes_threshold_cents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "bid_default_sealed" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "bid_reminder_days_before" integer NOT NULL DEFAULT 3;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "scope" text NOT NULL DEFAULT '',
  "building_num" integer,
  "unit_id" text,
  "trade_category" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "deadline" text NOT NULL,
  "sealed_bids" boolean NOT NULL DEFAULT false,
  "sealed_opened_at" text,
  "notify_non_awarded" boolean NOT NULL DEFAULT true,
  "created_by" integer,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "awarded_vendor_id" integer,
  "awarded_at" text,
  "award_rationale" text,
  "award_memo_storage_key" text,
  "awarded_work_order_id" text,
  "source_work_order_id" text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_scope_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "bid_request_id" integer NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "label" text NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_invitations" (
  "id" serial PRIMARY KEY NOT NULL,
  "bid_request_id" integer NOT NULL,
  "vendor_id" integer NOT NULL,
  "token_hash" text NOT NULL,
  "token_expires_at" text NOT NULL,
  "status" text NOT NULL DEFAULT 'invited',
  "invited_at" text NOT NULL,
  "viewed_at" text,
  "submitted_at" text,
  "declined_at" text,
  "reminder_sent_at" text,
  CONSTRAINT "bid_invitations_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "bid_invitations_bid_request_id_vendor_id_unique" UNIQUE ("bid_request_id","vendor_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_quotes" (
  "id" serial PRIMARY KEY NOT NULL,
  "bid_request_id" integer NOT NULL,
  "vendor_id" integer NOT NULL,
  "invitation_id" integer,
  "lead_time_days" integer,
  "payment_terms" text,
  "warranty_text" text,
  "notes" text,
  "license_storage_key" text,
  "coi_storage_key" text,
  "quote_pdf_storage_key" text,
  "entered_by_manager" boolean NOT NULL DEFAULT false,
  "firm_confirmation" boolean NOT NULL DEFAULT false,
  "total_cents" integer NOT NULL DEFAULT 0,
  "submitted_at" text NOT NULL,
  CONSTRAINT "bid_quotes_bid_request_id_vendor_id_unique" UNIQUE ("bid_request_id","vendor_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_quote_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "bid_quote_id" integer NOT NULL,
  "scope_item_id" integer NOT NULL,
  "amount_cents" integer NOT NULL DEFAULT 0,
  CONSTRAINT "bid_quote_lines_bid_quote_id_scope_item_id_unique" UNIQUE ("bid_quote_id","scope_item_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "bid_request_id" integer NOT NULL,
  "name" text NOT NULL,
  "size" integer NOT NULL DEFAULT 0,
  "content_type" text,
  "storage_key" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'spec',
  "uploaded_by_user_id" integer,
  "uploaded_by_name" text NOT NULL DEFAULT '',
  "uploaded_at" text NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_building_num_buildings_num_fk"
    FOREIGN KEY ("building_num") REFERENCES "buildings"("num") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_unit_id_units_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_awarded_vendor_id_vendors_id_fk"
    FOREIGN KEY ("awarded_vendor_id") REFERENCES "vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_awarded_work_order_id_work_orders_id_fk"
    FOREIGN KEY ("awarded_work_order_id") REFERENCES "work_orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_source_work_order_id_work_orders_id_fk"
    FOREIGN KEY ("source_work_order_id") REFERENCES "work_orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bid_scope_items" ADD CONSTRAINT "bid_scope_items_bid_request_id_bid_requests_id_fk"
    FOREIGN KEY ("bid_request_id") REFERENCES "bid_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_bid_request_id_bid_requests_id_fk"
    FOREIGN KEY ("bid_request_id") REFERENCES "bid_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_vendor_id_vendors_id_fk"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bid_quotes" ADD CONSTRAINT "bid_quotes_bid_request_id_bid_requests_id_fk"
    FOREIGN KEY ("bid_request_id") REFERENCES "bid_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_quotes" ADD CONSTRAINT "bid_quotes_vendor_id_vendors_id_fk"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_quotes" ADD CONSTRAINT "bid_quotes_invitation_id_bid_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "bid_invitations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bid_quote_lines" ADD CONSTRAINT "bid_quote_lines_bid_quote_id_bid_quotes_id_fk"
    FOREIGN KEY ("bid_quote_id") REFERENCES "bid_quotes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bid_quote_lines" ADD CONSTRAINT "bid_quote_lines_scope_item_id_bid_scope_items_id_fk"
    FOREIGN KEY ("scope_item_id") REFERENCES "bid_scope_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bid_attachments" ADD CONSTRAINT "bid_attachments_bid_request_id_bid_requests_id_fk"
    FOREIGN KEY ("bid_request_id") REFERENCES "bid_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
