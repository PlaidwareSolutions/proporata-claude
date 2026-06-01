CREATE TABLE IF NOT EXISTS "budgets" (
  "id" serial PRIMARY KEY NOT NULL,
  "category" text NOT NULL,
  "fiscal_year" integer NOT NULL,
  "amount" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "budgets_category_fiscal_year_unique" UNIQUE("category","fiscal_year")
);
