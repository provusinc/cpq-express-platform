CREATE TYPE "public"."quote_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'pending_customer_approval', 'customer_approved', 'customer_rejected');--> statement-breakpoint
CREATE TYPE "public"."label_term" AS ENUM('resource_role', 'product', 'add_on', 'phase');--> statement-breakpoint
CREATE TABLE "label_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"term" "label_term" NOT NULL,
	"singular" text,
	"plural" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_overrides_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "label_overrides_organization_id_term_key" UNIQUE("organization_id","term"),
	CONSTRAINT "label_overrides_only_hideable_disabled" CHECK ("label_overrides"."enabled" or "label_overrides"."term" in ('product', 'add_on'))
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"hours_per_day" numeric(4, 2) DEFAULT '8' NOT NULL,
	"deletable_statuses" "quote_status"[] DEFAULT '{draft,rejected}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "organization_settings_organization_id_key" UNIQUE("organization_id"),
	CONSTRAINT "organization_settings_hours_per_day_range" CHECK ("organization_settings"."hours_per_day" > 0 and "organization_settings"."hours_per_day" <= 24),
	CONSTRAINT "organization_settings_deletable_statuses_uncommitted" CHECK (not ("organization_settings"."deletable_statuses" && array['pending_approval', 'approved', 'pending_customer_approval', 'customer_approved']::quote_status[]))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "label_overrides" ADD CONSTRAINT "label_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;