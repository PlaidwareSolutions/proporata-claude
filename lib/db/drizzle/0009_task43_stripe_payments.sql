-- Task #43: Online assessment payments via Stripe
-- Adds Stripe-related tables and columns. Safe to run on databases that
-- already have these objects (idempotent via IF NOT EXISTS).

ALTER TABLE "owner_accounts" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint

ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "stripe_status" text;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "payment_source_id" integer;--> statement-breakpoint

ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "payments_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "payments_surcharge_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "payments_surcharge_percent_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "payments_auto_pay_lag_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "owner_payment_methods" (
  "id" serial PRIMARY KEY NOT NULL,
  "owner_account_id" integer NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "stripe_payment_method_id" text NOT NULL,
  "brand" text,
  "last4" text,
  "kind" text NOT NULL,
  "is_auto_pay" boolean DEFAULT false NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "owner_payment_methods_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "owner_payment_methods" ADD CONSTRAINT "owner_payment_methods_owner_account_id_owner_accounts_id_fk"
    FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_attempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "ledger_entry_id" integer,
  "paid_ledger_entry_id" integer,
  "owner_account_id" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "surcharge_cents" integer DEFAULT 0 NOT NULL,
  "refunded_amount_cents" integer DEFAULT 0 NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "stripe_payment_intent_id" text,
  "stripe_charge_id" text,
  "payment_method_id" integer,
  "initiated_by" text DEFAULT 'owner' NOT NULL,
  "error_message" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "paid_ledger_entry_id" integer;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "refunded_amount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "save_method_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "dispute_status" text;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_owner_account_id_owner_accounts_id_fk"
    FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payment_attempts_pi_idx" ON "payment_attempts" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_paid_ledger_entry_idx" ON "payment_attempts" ("paid_ledger_entry_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stripe_events_processed" (
  "stripe_event_id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "processed_at" text NOT NULL
);
