CREATE TABLE IF NOT EXISTS amenity_inspection_templates (
  id serial PRIMARY KEY,
  amenity_slug text,
  name text NOT NULL,
  kind text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS amenity_inspection_template_items (
  id serial PRIMARY KEY,
  template_id integer NOT NULL REFERENCES amenity_inspection_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  help_text text NOT NULL DEFAULT '',
  requires_photo boolean NOT NULL DEFAULT false,
  severity text NOT NULL DEFAULT 'warn',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS amenity_inspections (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL,
  template_id integer,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  inspector_user_id integer,
  inspector_name text NOT NULL DEFAULT '',
  inspector_role text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  signature text NOT NULL DEFAULT '',
  performed_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS amenity_inspection_item_results (
  id serial PRIMARY KEY,
  inspection_id integer NOT NULL REFERENCES amenity_inspections(id) ON DELETE CASCADE,
  template_item_id integer,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  note text NOT NULL DEFAULT '',
  photo_storage_key text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS amenity_damage_reports (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL,
  inspection_id integer,
  reported_by_user_id integer,
  reported_by_name text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  estimated_cost_cents integer NOT NULL DEFAULT 0,
  deposit_charged_cents integer NOT NULL DEFAULT 0,
  photo_storage_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  work_order_id text,
  manager_notes text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  resolved_at text
);

CREATE TABLE IF NOT EXISTS amenity_damage_disputes (
  id serial PRIMARY KEY,
  damage_report_id integer NOT NULL REFERENCES amenity_damage_reports(id) ON DELETE CASCADE,
  owner_user_id integer NOT NULL,
  owner_name text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  evidence_storage_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  manager_response text NOT NULL DEFAULT '',
  resolved_by_user_id integer,
  resolved_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS amenity_deposit_ledger (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL,
  kind text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  balance_cents integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  damage_report_id integer,
  actor_user_id integer,
  actor_name text NOT NULL DEFAULT '',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_chemistry_logs (
  id serial PRIMARY KEY,
  recorded_at text NOT NULL,
  recorded_by_user_id integer,
  recorded_by_name text NOT NULL DEFAULT '',
  free_chlorine_ppm double precision,
  total_chlorine_ppm double precision,
  ph double precision,
  alkalinity_ppm double precision,
  calcium_hardness_ppm double precision,
  cyanuric_acid_ppm double precision,
  temperature_f double precision,
  notes text NOT NULL DEFAULT '',
  flagged boolean NOT NULL DEFAULT false,
  flag_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  work_order_id text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_amenity_inspections_booking_id ON amenity_inspections(booking_id);
CREATE INDEX IF NOT EXISTS idx_amenity_damage_reports_booking_id ON amenity_damage_reports(booking_id);
CREATE INDEX IF NOT EXISTS idx_amenity_damage_disputes_report_id ON amenity_damage_disputes(damage_report_id);
CREATE INDEX IF NOT EXISTS idx_amenity_deposit_ledger_booking_id ON amenity_deposit_ledger(booking_id);
CREATE INDEX IF NOT EXISTS idx_pool_chemistry_logs_recorded_at ON pool_chemistry_logs(recorded_at);

-- Add FK to amenity_bookings if base table exists (idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='amenity_bookings') THEN
    BEGIN
      ALTER TABLE amenity_inspections
        ADD CONSTRAINT amenity_inspections_booking_fk
        FOREIGN KEY (booking_id) REFERENCES amenity_bookings(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER TABLE amenity_damage_reports
        ADD CONSTRAINT amenity_damage_reports_booking_fk
        FOREIGN KEY (booking_id) REFERENCES amenity_bookings(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER TABLE amenity_deposit_ledger
        ADD CONSTRAINT amenity_deposit_ledger_booking_fk
        FOREIGN KEY (booking_id) REFERENCES amenity_bookings(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
