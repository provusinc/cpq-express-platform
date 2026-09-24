CREATE TYPE "public"."billing_unit" AS ENUM('each', 'hour');--> statement-breakpoint
CREATE TYPE "public"."catalog_item_kind" AS ENUM('product', 'add_on');--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "catalog_item_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(19, 4) NOT NULL,
	"cost" numeric(19, 4) NOT NULL,
	"billing_unit" "billing_unit" DEFAULT 'each' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "catalog_items_product_billed_each" CHECK ("catalog_items"."kind" <> 'product' OR "catalog_items"."billing_unit" = 'each'),
	CONSTRAINT "catalog_items_price_non_negative" CHECK ("catalog_items"."price" >= 0),
	CONSTRAINT "catalog_items_cost_non_negative" CHECK ("catalog_items"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resource_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"bill_rate" numeric(19, 4) NOT NULL,
	"cost_rate" numeric(19, 4) NOT NULL,
	"location_country" text,
	"location_state" text,
	"location_city" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_roles_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "resource_roles_bill_rate_non_negative" CHECK ("resource_roles"."bill_rate" >= 0),
	CONSTRAINT "resource_roles_cost_rate_non_negative" CHECK ("resource_roles"."cost_rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_roles" ADD CONSTRAINT "resource_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_organization_id_kind_active_index" ON "catalog_items" USING btree ("organization_id","kind","active");--> statement-breakpoint
CREATE INDEX "catalog_items_tags_index" ON "catalog_items" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "resource_roles_organization_id_active_index" ON "resource_roles" USING btree ("organization_id","active");