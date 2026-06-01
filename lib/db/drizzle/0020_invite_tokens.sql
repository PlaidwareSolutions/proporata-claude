-- Task #30: invite-acceptance flow. Add the columns the API now reads/writes
-- so existing databases don't fail with missing-column errors when an admin
-- creates an invite or a resident opens the accept-invite link.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_token_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_token_expires_at" text;
