CREATE TYPE "public"."discount_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."time_period" AS ENUM('days', 'weeks', 'months', 'quarters');--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_by_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"valid_until" date,
	"time_period" time_period DEFAULT 'months' NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"currency_code" text NOT NULL,
	"discount_kind" "discount_kind",
	"discount_value" numeric(19, 4),
	"subtotal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"margin" numeric(19, 4) DEFAULT '0' NOT NULL,
	"margin_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "quotes_dates_ordered" CHECK ("quotes"."end_date" >= "quotes"."start_date"),
	CONSTRAINT "quotes_currency_code_format" CHECK ("quotes"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "quotes_discount_complete" CHECK (("quotes"."discount_kind" is null) = ("quotes"."discount_value" is null)),
	CONSTRAINT "quotes_discount_value_non_negative" CHECK ("quotes"."discount_value" is null or "quotes"."discount_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"quote_list_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"quote_list_hidden_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_account_id_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_organization_id_created_at_index" ON "quotes" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "quotes_organization_id_updated_at_index" ON "quotes" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "quotes_organization_id_status_index" ON "quotes" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "quotes_organization_id_owner_id_index" ON "quotes" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "quotes_organization_id_account_id_name_index" ON "quotes" USING btree ("organization_id","account_id",lower(btrim("name")));