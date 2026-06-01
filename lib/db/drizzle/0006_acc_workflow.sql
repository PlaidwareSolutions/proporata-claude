CREATE TABLE "acc_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"name" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"content_type" text,
	"storage_key" text NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"uploaded_by_name" text DEFAULT '' NOT NULL,
	"uploaded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"type" text NOT NULL,
	"author_user_id" integer,
	"author_name" text DEFAULT '' NOT NULL,
	"author_role" text,
	"body" text,
	"from_status" text,
	"to_status" text,
	"vote_value" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architectural_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" text NOT NULL,
	"building" integer NOT NULL,
	"owner_user_id" integer NOT NULL,
	"owner_name" text DEFAULT '' NOT NULL,
	"project_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"contractor_name" text,
	"planned_start" text,
	"planned_end" text,
	"acknowledged_guidelines" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"submitted_at" text NOT NULL,
	"decided_at" text,
	"decision_text" text,
	"conditions_text" text,
	"decision_letter_storage_key" text,
	"auto_approval_flagged" boolean DEFAULT false NOT NULL,
	"auto_approval_flagged_at" text
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_group" text NOT NULL,
	"building_id" integer,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" text NOT NULL,
	"sent_by" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"drive_refresh_token" text,
	"drive_account_email" text,
	"drive_connected_at" text,
	"drive_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text DEFAULT 'manager' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"unit_id" text,
	"pending" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trade_category" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"license_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "drive_file_id" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "acc_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "acc_quorum_mode" text DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "acc_auto_approval_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "owner_phone" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "tenant_name" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "tenant_phone" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "tenant_email" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "vendor_id" integer;--> statement-breakpoint
ALTER TABLE "acc_attachments" ADD CONSTRAINT "acc_attachments_request_id_architectural_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."architectural_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_attachments" ADD CONSTRAINT "acc_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_events" ADD CONSTRAINT "acc_events_request_id_architectural_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."architectural_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_events" ADD CONSTRAINT "acc_events_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architectural_requests" ADD CONSTRAINT "architectural_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architectural_requests" ADD CONSTRAINT "architectural_requests_building_buildings_num_fk" FOREIGN KEY ("building") REFERENCES "public"."buildings"("num") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architectural_requests" ADD CONSTRAINT "architectural_requests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_unit_units_id_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;