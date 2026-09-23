CREATE TYPE "public"."document_format" AS ENUM('standard', 'compact');--> statement-breakpoint
CREATE TYPE "public"."document_section" AS ENUM('header', 'bill_to', 'overview', 'line_items', 'summary', 'milestones', 'terms', 'footer');--> statement-breakpoint
CREATE TABLE "document_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"format" "document_format" DEFAULT 'standard' NOT NULL,
	"primary_color" text DEFAULT '#1f2937' NOT NULL,
	"accent_color" text DEFAULT '#2563eb' NOT NULL,
	"section_order" "document_section"[] DEFAULT '{header,bill_to,overview,line_items,summary,milestones,terms,footer}' NOT NULL,
	"hidden_sections" "document_section"[] DEFAULT '{}' NOT NULL,
	"money_decimals" smallint,
	"quantity_decimals" smallint DEFAULT 2 NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"footer_text" text,
	"terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_settings_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "document_settings_organization_id_key" UNIQUE("organization_id"),
	CONSTRAINT "document_settings_colors_hex" CHECK ("document_settings"."primary_color" ~ '^#[0-9a-f]{6}$' and "document_settings"."accent_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "document_settings_money_decimals_range" CHECK ("document_settings"."money_decimals" is null or "document_settings"."money_decimals" between 0 and 4),
	CONSTRAINT "document_settings_quantity_decimals_range" CHECK ("document_settings"."quantity_decimals" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "quote_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_size" bigint NOT NULL,
	"quote_snapshot" jsonb NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"notes" text,
	"captured_by_mark_sent" boolean DEFAULT false NOT NULL,
	"generated_by_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_documents_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "quote_documents_quote_version_key" UNIQUE("organization_id","quote_id","version"),
	CONSTRAINT "quote_documents_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "quote_documents_version_positive" CHECK ("quote_documents"."version" > 0),
	CONSTRAINT "quote_documents_file_size_non_negative" CHECK ("quote_documents"."file_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "document_settings" ADD CONSTRAINT "document_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_generated_by_id_users_id_fk" FOREIGN KEY ("generated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_quote_id_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_documents_organization_id_quote_id_generated_at_index" ON "quote_documents" USING btree ("organization_id","quote_id","generated_at");