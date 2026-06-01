-- Task #87: Mail & Package Room schema (idempotent).

CREATE TABLE IF NOT EXISTS "package_lockers" (
  "id" serial PRIMARY KEY NOT NULL,
  "bank_slug" text NOT NULL DEFAULT 'default',
  "bay" text NOT NULL,
  "size" text NOT NULL DEFAULT 'medium',
  "notes" text NOT NULL DEFAULT '',
  "out_of_service" boolean NOT NULL DEFAULT false,
  "created_at" text NOT NULL,
  CONSTRAINT package_lockers_bank_bay_unique UNIQUE ("bank_slug", "bay")
);

CREATE TABLE IF NOT EXISTS "packages" (
  "id" serial PRIMARY KEY NOT NULL,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "recipient_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "recipient_name" text NOT NULL DEFAULT '',
  "carrier" text NOT NULL DEFAULT 'Other',
  "tracking_number" text NOT NULL DEFAULT '',
  "size" text NOT NULL DEFAULT 'medium',
  "notes" text NOT NULL DEFAULT '',
  "intake_photo_storage_key" text,
  "pickup_photo_storage_key" text,
  "pickup_code" text NOT NULL UNIQUE,
  "qr_payload" text NOT NULL,
  "locker_id" integer REFERENCES "package_lockers"("id") ON DELETE SET NULL,
  "locker_pin" text,
  "status" text NOT NULL DEFAULT 'received',
  "held_until" text,
  "stale_at" text,
  "rts_at" text,
  "picked_up_at" text,
  "picked_up_by_name" text NOT NULL DEFAULT '',
  "picked_up_by_user_id" integer,
  "intake_by_user_id" integer,
  "intake_by_name" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "package_pickup_authorizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "package_id" integer NOT NULL REFERENCES "packages"("id") ON DELETE CASCADE,
  "authorized_name" text NOT NULL,
  "authorized_user_id" integer,
  "note" text NOT NULL DEFAULT '',
  "created_by_user_id" integer,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "package_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "package_id" integer NOT NULL,
  "action" text NOT NULL,
  "actor_user_id" integer,
  "actor_name" text NOT NULL DEFAULT '',
  "diff" jsonb,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "mail_hold_windows" (
  "id" serial PRIMARY KEY NOT NULL,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "starts_on" text NOT NULL,
  "ends_on" text NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "created_by_user_id" integer,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "packages_unit_id_idx" ON "packages" ("unit_id");
CREATE INDEX IF NOT EXISTS "packages_status_idx" ON "packages" ("status");
CREATE INDEX IF NOT EXISTS "package_audit_package_id_idx" ON "package_audit" ("package_id");
CREATE INDEX IF NOT EXISTS "mail_hold_windows_unit_id_idx" ON "mail_hold_windows" ("unit_id");
