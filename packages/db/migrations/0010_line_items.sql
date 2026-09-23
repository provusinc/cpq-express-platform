CREATE TYPE "public"."period_type" AS ENUM('week', 'month', 'quarter');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('product', 'add_on', 'resource_role');--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "allocations_line_item_period_key" UNIQUE("organization_id","line_item_id","period_type","period_start"),
	CONSTRAINT "allocations_amount_positive" CHECK ("allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"phase_id" uuid,
	"source_kind" "source_kind" NOT NULL,
	"catalog_item_id" uuid,
	"resource_role_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"notes" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"billing_unit" "billing_unit" NOT NULL,
	"base_price" numeric(19, 4) NOT NULL,
	"base_cost" numeric(19, 4) NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"line_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_margin_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_items_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "line_items_source_matches_kind" CHECK (("line_items"."source_kind" = 'resource_role' and "line_items"."resource_role_id" is not null and "line_items"."catalog_item_id" is null)
        or ("line_items"."source_kind" <> 'resource_role' and "line_items"."catalog_item_id" is not null and "line_items"."resource_role_id" is null)),
	CONSTRAINT "line_items_billing_unit_matches_kind" CHECK (("line_items"."source_kind" <> 'resource_role' or "line_items"."billing_unit" = 'hour')
        and ("line_items"."source_kind" <> 'product' or "line_items"."billing_unit" = 'each')),
	CONSTRAINT "line_items_dates_ordered" CHECK ("line_items"."end_date" >= "line_items"."start_date"),
	CONSTRAINT "line_items_quantity_non_negative" CHECK ("line_items"."quantity" >= 0),
	CONSTRAINT "line_items_rates_non_negative" CHECK ("line_items"."base_price" >= 0 and "line_items"."base_cost" >= 0 and "line_items"."unit_price" >= 0 and "line_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phases_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "phases_organization_id_quote_id_id_key" UNIQUE("organization_id","quote_id","id"),
	CONSTRAINT "phases_not_own_parent" CHECK ("phases"."parent_id" is distinct from "phases"."id")
);
--> statement-breakpoint
CREATE TABLE "undo_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "undo_snapshots_organization_id_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_line_item_id_fk" FOREIGN KEY ("organization_id","line_item_id") REFERENCES "public"."line_items"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_quote_id_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_catalog_item_id_fk" FOREIGN KEY ("organization_id","catalog_item_id") REFERENCES "public"."catalog_items"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_resource_role_id_fk" FOREIGN KEY ("organization_id","resource_role_id") REFERENCES "public"."resource_roles"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_phase_id_fk" FOREIGN KEY ("organization_id","quote_id","phase_id") REFERENCES "public"."phases"("organization_id","quote_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_quote_id_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_parent_id_fk" FOREIGN KEY ("organization_id","quote_id","parent_id") REFERENCES "public"."phases"("organization_id","quote_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_snapshots" ADD CONSTRAINT "undo_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_snapshots" ADD CONSTRAINT "undo_snapshots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_snapshots" ADD CONSTRAINT "undo_snapshots_quote_id_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_items_organization_id_quote_id_sequence_index" ON "line_items" USING btree ("organization_id","quote_id","sequence");--> statement-breakpoint
CREATE INDEX "line_items_organization_id_catalog_item_id_index" ON "line_items" USING btree ("organization_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "line_items_organization_id_resource_role_id_index" ON "line_items" USING btree ("organization_id","resource_role_id");--> statement-breakpoint
CREATE INDEX "phases_organization_id_quote_id_sequence_index" ON "phases" USING btree ("organization_id","quote_id","sequence");--> statement-breakpoint
CREATE INDEX "undo_snapshots_organization_id_expires_at_index" ON "undo_snapshots" USING btree ("organization_id","expires_at");