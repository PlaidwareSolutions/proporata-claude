#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Task #63: Resolutions library — idempotent ensure of the table and its
# self-referential FK + unique-per-year-seq partial index. drizzle-kit push
# typically handles new tables, but the partial unique index isn't expressible
# in the schema and must be applied here.
psql "$DATABASE_URL" <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "resolutions_year_seq_unique"
  ON "resolutions" ("number_year", "number_seq")
  WHERE "number" IS NOT NULL;
SQL
# Idempotent ALTER: ensure documents.unit column exists for unit-level subfolders
psql "$DATABASE_URL" -c "ALTER TABLE documents ADD COLUMN IF NOT EXISTS unit text REFERENCES units(id);"
# Task #59: ensure board_member column exists and backfill existing
# admins/managers so the Stripe approval flow keeps working when the roster
# switches from role-based to flag-based. drizzle-kit push will add the column
# but does not run backfill UPDATEs — this block does. Idempotent.
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE users ADD COLUMN IF NOT EXISTS board_member boolean DEFAULT false NOT NULL;
UPDATE users SET board_member = true
 WHERE board_member = false AND role IN ('admin', 'manager');
SQL
echo "Board-member backfill complete."

# Membership eligibility: ownership_status on owner_accounts, plus the
# configurable past-due voting threshold on organization_settings.
# drizzle-kit push will add the columns; this block makes the rollout
# safe on existing rows. Idempotent.
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS ownership_status text DEFAULT 'active' NOT NULL;
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS ownership_status_changed_at text;
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS ownership_status_reason text;
ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS past_due_voting_threshold_days integer DEFAULT 60 NOT NULL;
UPDATE owner_accounts SET ownership_status = 'active' WHERE ownership_status IS NULL;
SQL
echo "Membership ownership_status backfill complete."

# Task #146: Welcome-tour version. drizzle-kit push adds the columns; this
# block backfills `tour_version_seen=1` for users who already completed the
# tour before this feature shipped, so they aren't surprise-prompted on the
# initial v1 rollout. Only an explicit admin bump to v2+ should re-open the
# tour for them. Idempotent.
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS current_tour_version integer NOT NULL DEFAULT 1;
ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS tour_version_seen integer;
UPDATE user_onboarding
   SET tour_version_seen = 1
 WHERE tour_completed = true
   AND tour_version_seen IS NULL;
SQL
echo "Welcome-tour version backfill complete."

# Task #30: invite-accept set-password flow. drizzle-kit push adds the
# columns; this block makes the rollout idempotent on existing rows.
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_expires_at text;
SQL
echo "Invite-accept columns ensured."

# Task #83: Amenity inspections / damage / disputes / deposit ledger /
# pool chemistry — additive tables, all guarded with IF NOT EXISTS.
psql "$DATABASE_URL" -f scripts/task83.sql
echo "Task #83 amenity inspection schema applied."
# Seed property data (buildings + units) — idempotent via ON CONFLICT DO UPDATE
# (refreshes existing rows so seed edits propagate on re-run)
psql "$DATABASE_URL" -f scripts/seed-property-data.sql
echo "Property data seed complete."
# Re-seed admin user if missing — only when ADMIN_PASSWORD env var is explicitly set
if [ -n "$ADMIN_PASSWORD" ]; then
  psql "$DATABASE_URL" -v admin_pw="$ADMIN_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO users (email, password_hash, role, name, pending, created_at)
VALUES (
  'admin@quailvalleyhoa.org',
  crypt(:'admin_pw', gen_salt('bf', 12)),
  'admin',
  'Admin',
  false,
  NOW()
)
ON CONFLICT (email) DO NOTHING;
SQL
  echo "Admin seed complete."
else
  echo "ADMIN_PASSWORD not set — skipping admin seed."
fi

# Task #122: Demo seed — populates ~25 entity domains with realistic data and
# elevates Unit B01-U01 (Dylan Taylor) to a hero unit. Idempotent. Only runs
# when SEED_DEMO_DATA=1 is explicitly set so production deploys are unaffected.
if [ "$SEED_DEMO_DATA" = "1" ]; then
  echo "SEED_DEMO_DATA=1 — running demo seed..."
  pnpm --filter @workspace/api-server run seed:demo
  echo "Demo seed complete."
else
  echo "SEED_DEMO_DATA not set — skipping demo seed."
fi
