-- Task #89: Amenity Compliance & Safety Records.

CREATE TABLE IF NOT EXISTS "amenity_required_postings" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "template_body" text NOT NULL DEFAULT '',
  "replace_every_days" integer NOT NULL DEFAULT 0,
  "required" boolean NOT NULL DEFAULT true,
  "citation" text NOT NULL DEFAULT '',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_required_postings_amenity_idx"
  ON "amenity_required_postings" ("amenity_id");

CREATE TABLE IF NOT EXISTS "amenity_posting_issuances" (
  "id" serial PRIMARY KEY NOT NULL,
  "posting_id" integer NOT NULL REFERENCES "amenity_required_postings"("id") ON DELETE CASCADE,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "rendered_body" text NOT NULL DEFAULT '',
  "document_storage_key" text,
  "posted_at" text NOT NULL,
  "posted_by_user_id" integer,
  "posted_by_name" text NOT NULL DEFAULT '',
  "expires_at" text,
  "status" text NOT NULL DEFAULT 'active',
  "removed_at" text,
  "removed_reason" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_posting_issuances_posting_idx"
  ON "amenity_posting_issuances" ("posting_id");
CREATE INDEX IF NOT EXISTS "amenity_posting_issuances_amenity_idx"
  ON "amenity_posting_issuances" ("amenity_id");

CREATE TABLE IF NOT EXISTS "amenity_certificates" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "issuer" text NOT NULL DEFAULT '',
  "identifier" text NOT NULL DEFAULT '',
  "vendor_id" integer REFERENCES "vendors"("id") ON DELETE SET NULL,
  "effective_on" text,
  "expires_on" text,
  "document_storage_key" text,
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_certificates_amenity_idx"
  ON "amenity_certificates" ("amenity_id");

CREATE TABLE IF NOT EXISTS "amenity_annual_inspections" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "scheduled_on" text NOT NULL,
  "performed_on" text,
  "inspector_name" text NOT NULL DEFAULT '',
  "inspector_agency" text NOT NULL DEFAULT '',
  "inspector_user_id" integer,
  "status" text NOT NULL DEFAULT 'scheduled',
  "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "report_storage_key" text,
  "notes" text NOT NULL DEFAULT '',
  "work_order_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "calendar_event_id" integer,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_annual_inspections_amenity_idx"
  ON "amenity_annual_inspections" ("amenity_id");

CREATE TABLE IF NOT EXISTS "amenity_incident_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "booking_id" integer REFERENCES "amenity_bookings"("id") ON DELETE SET NULL,
  "occurred_at" text NOT NULL,
  "reported_at" text NOT NULL,
  "reported_by_user_id" integer,
  "reported_by_name" text NOT NULL DEFAULT '',
  "reported_by_role" text NOT NULL DEFAULT '',
  "kind" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'minor',
  "involved_parties" text NOT NULL DEFAULT '',
  "witnesses" text NOT NULL DEFAULT '',
  "ems_called" boolean NOT NULL DEFAULT false,
  "police_called" boolean NOT NULL DEFAULT false,
  "insurance_notified" boolean NOT NULL DEFAULT false,
  "insurance_claim_number" text NOT NULL DEFAULT '',
  "narrative" text NOT NULL DEFAULT '',
  "immediate_actions" text NOT NULL DEFAULT '',
  "follow_up_actions" text NOT NULL DEFAULT '',
  "follow_up_due_on" text,
  "status" text NOT NULL DEFAULT 'open',
  "closed_at" text,
  "closed_by_user_id" integer,
  "work_order_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "owner_visible" boolean NOT NULL DEFAULT false,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_incident_reports_amenity_idx"
  ON "amenity_incident_reports" ("amenity_id");
CREATE INDEX IF NOT EXISTS "amenity_incident_reports_status_idx"
  ON "amenity_incident_reports" ("status");

CREATE TABLE IF NOT EXISTS "amenity_incident_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "incident_id" integer NOT NULL REFERENCES "amenity_incident_reports"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "caption" text NOT NULL DEFAULT '',
  "uploaded_by_user_id" integer,
  "uploaded_by_name" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_incident_attachments_incident_idx"
  ON "amenity_incident_attachments" ("incident_id");

CREATE TABLE IF NOT EXISTS "amenity_incident_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "incident_id" integer NOT NULL REFERENCES "amenity_incident_reports"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "actor_user_id" integer,
  "actor_name" text NOT NULL DEFAULT '',
  "diff" jsonb,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_incident_audit_incident_idx"
  ON "amenity_incident_audit" ("incident_id");

CREATE TABLE IF NOT EXISTS "amenity_emergency_procedures" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL UNIQUE REFERENCES "amenities"("id") ON DELETE CASCADE,
  "emergency_contact" text NOT NULL DEFAULT '911',
  "manager_on_call_name" text NOT NULL DEFAULT '',
  "manager_on_call_phone" text NOT NULL DEFAULT '',
  "evacuation_route" text NOT NULL DEFAULT '',
  "shelter_location" text NOT NULL DEFAULT '',
  "hazard_notes" text NOT NULL DEFAULT '',
  "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "posted_storage_key" text,
  "updated_at" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "amenity_safety_pins" (
  "id" serial PRIMARY KEY NOT NULL,
  "amenity_id" integer NOT NULL REFERENCES "amenities"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "location_description" text NOT NULL DEFAULT '',
  "pos_x" double precision,
  "pos_y" double precision,
  "last_checked_on" text,
  "last_checked_by_name" text NOT NULL DEFAULT '',
  "service_due_on" text,
  "notes" text NOT NULL DEFAULT '',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "amenity_safety_pins_amenity_idx"
  ON "amenity_safety_pins" ("amenity_id");
