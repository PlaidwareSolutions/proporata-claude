CREATE TABLE IF NOT EXISTS "owner_accounts" (
        "id" serial PRIMARY KEY NOT NULL,
        "unit_id" text NOT NULL,
        "opening_balance" integer DEFAULT 0 NOT NULL,
        "created_at" text NOT NULL,
        CONSTRAINT "owner_accounts_unit_id_unique" UNIQUE("unit_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
        "id" serial PRIMARY KEY NOT NULL,
        "owner_account_id" integer NOT NULL,
        "occurred_on" text NOT NULL,
        "posted_at" text NOT NULL,
        "kind" text NOT NULL,
        "charge_type" text,
        "payment_method" text,
        "amount_cents" integer NOT NULL,
        "memo" text,
        "posted_by" integer NOT NULL,
        "voided_at" text,
        "voided_by" integer,
        "voids_entry_id" integer,
        "batch_ref" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "owner_accounts" ADD CONSTRAINT "owner_accounts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_owner_account_id_owner_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."owner_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_owner_account_id_idx" ON "ledger_entries" ("owner_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_occurred_on_idx" ON "ledger_entries" ("occurred_on");
--> statement-breakpoint
INSERT INTO "owner_accounts" ("unit_id", "opening_balance", "created_at")
SELECT u."id", 0, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM "units" u
LEFT JOIN "owner_accounts" oa ON oa."unit_id" = u."id"
WHERE oa."id" IS NULL;
