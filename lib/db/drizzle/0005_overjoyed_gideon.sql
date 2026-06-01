CREATE TABLE IF NOT EXISTS "work_order_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"name" text,
	"uploaded_by" integer,
	"uploaded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" integer,
	"actor_name" text,
	"payload" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
