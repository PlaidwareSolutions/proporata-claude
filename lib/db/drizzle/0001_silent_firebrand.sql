CREATE TABLE "document_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "map_markers" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_num" integer NOT NULL,
	"view" text NOT NULL,
	"left" double precision NOT NULL,
	"top" double precision NOT NULL,
	CONSTRAINT "map_markers_building_num_view_unique" UNIQUE("building_num","view")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"address" text,
	"contact_email" text,
	"phone" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"notification_preferences" jsonb
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"urgent" integer DEFAULT 1 NOT NULL,
	"expiring" integer DEFAULT 1 NOT NULL,
	"weekly" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_building_num_buildings_num_fk" FOREIGN KEY ("building_num") REFERENCES "public"."buildings"("num") ON DELETE no action ON UPDATE no action;