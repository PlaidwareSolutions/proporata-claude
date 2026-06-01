-- Task #86: EV chargers & metered amenities. Idempotent.

CREATE TABLE IF NOT EXISTS "charging_ports" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "location" text NOT NULL DEFAULT '',
  "connector_type" text NOT NULL DEFAULT 'J1772',
  "max_kw" integer NOT NULL DEFAULT 7,
  "mode" text NOT NULL DEFAULT 'reserved',
  "provider" text NOT NULL DEFAULT 'manual',
  "provider_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "per_kwh_cents" integer NOT NULL DEFAULT 35,
  "idle_per_minute_cents" integer NOT NULL DEFAULT 40,
  "idle_grace_minutes" integer NOT NULL DEFAULT 10,
  "idle_cap_cents" integer NOT NULL DEFAULT 2000,
  "no_show_fee_cents" integer NOT NULL DEFAULT 0,
  "no_show_grace_minutes" integer NOT NULL DEFAULT 15,
  "enabled" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charging_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "port_id" integer NOT NULL REFERENCES "charging_ports"("id") ON DELETE CASCADE,
  "owner_user_id" integer NOT NULL,
  "unit_id" text,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "session_id" integer,
  "no_show_fee_ledger_entry_id" integer,
  "cancelled_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "charging_reservations_port_idx" ON "charging_reservations" ("port_id", "starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charging_reservations_owner_idx" ON "charging_reservations" ("owner_user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charging_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "port_id" integer NOT NULL REFERENCES "charging_ports"("id") ON DELETE RESTRICT,
  "reservation_id" integer,
  "owner_user_id" integer NOT NULL,
  "unit_id" text,
  "start_at" text NOT NULL,
  "end_at" text,
  "scheduled_end_at" text,
  "kwh" numeric(12, 4) NOT NULL DEFAULT '0',
  "meter_start_kwh" numeric(12, 4),
  "meter_end_kwh" numeric(12, 4),
  "energy_cost_cents" integer NOT NULL DEFAULT 0,
  "idle_minutes" integer NOT NULL DEFAULT 0,
  "idle_cost_cents" integer NOT NULL DEFAULT 0,
  "cost_cents" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "provider_session_ref" text,
  "ledger_entry_id" integer,
  "refund_ledger_entry_id" integer,
  "refund_reason" text,
  "last_polled_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "charging_sessions_port_idx" ON "charging_sessions" ("port_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charging_sessions_owner_idx" ON "charging_sessions" ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charging_sessions_status_idx" ON "charging_sessions" ("status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charging_session_usage_samples" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL REFERENCES "charging_sessions"("id") ON DELETE CASCADE,
  "sampled_at" text NOT NULL,
  "kwh" numeric(12, 4) NOT NULL,
  "power_kw" numeric(10, 3)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "charging_session_usage_samples_session_idx" ON "charging_session_usage_samples" ("session_id", "sampled_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charging_session_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL,
  "action" text NOT NULL,
  "actor_user_id" integer,
  "actor_name" text NOT NULL DEFAULT '',
  "diff" jsonb,
  "created_at" text NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "charging_session_audit_session_idx" ON "charging_session_audit" ("session_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charging_idle_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL REFERENCES "charging_sessions"("id") ON DELETE CASCADE,
  "started_at" text NOT NULL,
  "ended_at" text,
  "minutes" integer NOT NULL DEFAULT 0,
  "fee_cents" integer NOT NULL DEFAULT 0
);
