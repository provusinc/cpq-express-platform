CREATE TABLE "catalog_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"singular" text NOT NULL,
	"plural" text NOT NULL,
	"billing_units" "billing_unit"[] NOT NULL,
	"colour_index" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_types_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "catalog_types_names_not_blank" CHECK (btrim("catalog_types"."singular") <> '' and btrim("catalog_types"."plural") <> ''),
	CONSTRAINT "catalog_types_billing_units_not_empty" CHECK (cardinality("catalog_types"."billing_units") > 0),
	CONSTRAINT "catalog_types_colour_index_range" CHECK ("catalog_types"."colour_index" >= 0 and "catalog_types"."colour_index" < 6),
	CONSTRAINT "catalog_types_sequence_non_negative" CHECK ("catalog_types"."sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "catalog_type_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_types" ADD CONSTRAINT "catalog_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_types_organization_id_singular_key" ON "catalog_types" USING btree ("organization_id",lower("singular"));--> statement-breakpoint
CREATE INDEX "catalog_types_organization_id_sequence_index" ON "catalog_types" USING btree ("organization_id","sequence");--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_catalog_type_id_fk" FOREIGN KEY ("organization_id","catalog_type_id") REFERENCES "public"."catalog_types"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_organization_id_catalog_type_id_active_index" ON "catalog_items" USING btree ("organization_id","catalog_type_id","active");--> statement-breakpoint
-- Data migration (#30): Product and Add-on become ordinary Catalog Types.
-- Written by hand. Ids are UUIDv7, built in SQL (Postgres 17 has no uuidv7()).
--
-- 1. Every Organization gets Product (Each) and Add-on (Each, Hour), named by
--    its Label Override for the term where one was set (a blank name falls
--    back to the canonical one) and inactive where the term was hidden.
--    `DEFAULT_CATALOG_TYPES` in @workspace/domain/catalog, as of this migration.
INSERT INTO "catalog_types" ("id", "organization_id", "singular", "plural", "billing_units", "colour_index", "active", "sequence")
SELECT
	encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
	o."id",
	coalesce(nullif(btrim(lo."singular"), ''), d."singular"),
	coalesce(nullif(btrim(lo."plural"), ''), d."plural"),
	d."billing_units"::"billing_unit"[],
	d."sequence",
	coalesce(lo."enabled", true),
	d."sequence"
FROM "organizations" o
CROSS JOIN (VALUES
	('product', 'Product', 'Products', '{each}', 0),
	('add_on', 'Add-on', 'Add-ons', '{each,hour}', 1)
) AS d("term", "singular", "plural", "billing_units", "sequence")
LEFT JOIN "label_overrides" lo
	ON lo."organization_id" = o."id" AND lo."term"::text = d."term"
WHERE d."term" = 'product'
ORDER BY o."id";
--> statement-breakpoint
-- (Add-on separately, so an Add-on override naming it like the Product type
-- falls back to "Add-on" instead of breaking the unique name.)
INSERT INTO "catalog_types" ("id", "organization_id", "singular", "plural", "billing_units", "colour_index", "active", "sequence")
SELECT
	encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
	o."id",
	CASE WHEN named."singular" IS NULL OR lower(named."singular") = lower(p."singular") THEN 'Add-on' ELSE named."singular" END,
	CASE WHEN lower(named."singular") = lower(p."singular") THEN 'Add-ons' ELSE coalesce(named."plural", 'Add-ons') END,
	'{each,hour}'::"billing_unit"[],
	1,
	coalesce(lo."enabled", true),
	1
FROM "organizations" o
JOIN "catalog_types" p ON p."organization_id" = o."id"
LEFT JOIN "label_overrides" lo ON lo."organization_id" = o."id" AND lo."term" = 'add_on'
CROSS JOIN LATERAL (SELECT nullif(btrim(lo."singular"), '') AS "singular", nullif(btrim(lo."plural"), '') AS "plural") named
ORDER BY o."id";
--> statement-breakpoint
-- 2. Every Catalog Item points at the type of its kind.
UPDATE "catalog_items" ci SET "catalog_type_id" = t."id"
FROM "catalog_types" t
WHERE t."organization_id" = ci."organization_id"
	AND t."sequence" = CASE ci."kind" WHEN 'product' THEN 0 ELSE 1 END;
