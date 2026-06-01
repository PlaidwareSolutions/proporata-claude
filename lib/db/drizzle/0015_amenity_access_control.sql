-- Task #82: Amenity access control.

CREATE TABLE IF NOT EXISTS "amenity_access_providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL UNIQUE REFERENCES "amenities"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'none',
  "base_url_env_var" text,
  "api_key_env_var" text,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "amenity_access_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_id" integer NOT NULL UNIQUE REFERENCES "amenity_bookings"("id") ON DELETE CASCADE,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "code" text NOT NULL UNIQUE,
  "qr_payload" text NOT NULL,
  "valid_from" text NOT NULL,
  "valid_to" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "provider_kind" text NOT NULL DEFAULT 'none',
  "provider_ref" text,
  "issued_at" text NOT NULL,
  "revoked_at" text
);

CREATE TABLE IF NOT EXISTS "fob_inventory" (
  "id" serial PRIMARY KEY NOT NULL,
  "serial" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'available',
  "zone_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "fob_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "fob_id" integer NOT NULL REFERENCES "fob_inventory"("id") ON DELETE CASCADE,
  "unit_id" text REFERENCES "units"("id") ON DELETE SET NULL,
  "booking_id" integer REFERENCES "amenity_bookings"("id") ON DELETE SET NULL,
  "assigned_to_user_id" integer,
  "assigned_to_name" text NOT NULL DEFAULT '',
  "assigned_at" text NOT NULL,
  "returned_at" text,
  "returned_note" text NOT NULL DEFAULT '',
  "assigned_by_user_id" integer
);

CREATE TABLE IF NOT EXISTS "pool_tags" (
  "id" serial PRIMARY KEY NOT NULL,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "resident_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "resident_name" text NOT NULL DEFAULT '',
  "photo_storage_key" text,
  "expires_at" text,
  "status" text NOT NULL DEFAULT 'active',
  "suspended_reason" text NOT NULL DEFAULT '',
  "suspended_at" text,
  "issued_at" text NOT NULL,
  "issued_by_user_id" integer,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "unit_vehicles" (
  "id" serial PRIMARY KEY NOT NULL,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "plate" text NOT NULL,
  "state" text NOT NULL DEFAULT '',
  "make" text NOT NULL DEFAULT '',
  "model" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "booking_guest_passes" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_id" integer NOT NULL REFERENCES "amenity_bookings"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "plate" text NOT NULL DEFAULT '',
  "vehicle_desc" text NOT NULL DEFAULT '',
  "checked_in_at" text,
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "amenity_access_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_id" integer,
  "amenity_id" integer,
  "access_code_id" integer,
  "provider_kind" text NOT NULL DEFAULT 'none',
  "action" text NOT NULL,
  "success" boolean NOT NULL DEFAULT true,
  "actor_user_id" integer,
  "actor_name" text NOT NULL DEFAULT '',
  "message" text NOT NULL DEFAULT '',
  "payload" jsonb,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_access_codes_booking_idx" ON "amenity_access_codes" ("booking_id");
CREATE INDEX IF NOT EXISTS "amenity_access_codes_code_idx" ON "amenity_access_codes" ("code");
CREATE INDEX IF NOT EXISTS "fob_assignments_fob_idx" ON "fob_assignments" ("fob_id");
CREATE INDEX IF NOT EXISTS "fob_assignments_unit_idx" ON "fob_assignments" ("unit_id");
CREATE INDEX IF NOT EXISTS "pool_tags_unit_idx" ON "pool_tags" ("unit_id");
CREATE INDEX IF NOT EXISTS "unit_vehicles_unit_idx" ON "unit_vehicles" ("unit_id");
CREATE INDEX IF NOT EXISTS "unit_vehicles_plate_idx" ON "unit_vehicles" ("plate");
CREATE INDEX IF NOT EXISTS "booking_guest_passes_booking_idx" ON "booking_guest_passes" ("booking_id");
CREATE INDEX IF NOT EXISTS "amenity_access_audit_booking_idx" ON "amenity_access_audit" ("booking_id");
