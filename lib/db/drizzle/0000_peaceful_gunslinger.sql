CREATE TABLE "buildings" (
	"num" integer PRIMARY KEY NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"w" integer NOT NULL,
	"h" integer NOT NULL,
	"status" text NOT NULL,
	"open_wo" integer DEFAULT 0 NOT NULL,
	"address" text NOT NULL,
	"street" text NOT NULL,
	"units" integer NOT NULL,
	"year_built" integer NOT NULL,
	"roof_year" integer NOT NULL,
	"insurance_status" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"building" integer,
	"uploaded" text NOT NULL,
	"size" text NOT NULL,
	"uploaded_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"building" integer NOT NULL,
	"carrier" text NOT NULL,
	"policy_no" text NOT NULL,
	"coverage" integer NOT NULL,
	"premium" integer NOT NULL,
	"expires" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "insurance_policies_building_unique" UNIQUE("building")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"building" integer NOT NULL,
	"unit" text NOT NULL,
	"address" text NOT NULL,
	"beds" integer NOT NULL,
	"baths" double precision NOT NULL,
	"sqft" integer NOT NULL,
	"occupancy" text NOT NULL,
	"owner_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"building" integer NOT NULL,
	"unit" text,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"vendor" text,
	"opened" text NOT NULL,
	"due" text,
	"est_cost" integer DEFAULT 0 NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_building_buildings_num_fk" FOREIGN KEY ("building") REFERENCES "public"."buildings"("num") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_building_buildings_num_fk" FOREIGN KEY ("building") REFERENCES "public"."buildings"("num") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_building_buildings_num_fk" FOREIGN KEY ("building") REFERENCES "public"."buildings"("num") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_building_buildings_num_fk" FOREIGN KEY ("building") REFERENCES "public"."buildings"("num") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unit_units_id_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;