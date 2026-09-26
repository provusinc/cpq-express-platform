CREATE TYPE "public"."customer_classification_kind" AS ENUM('customer_type', 'industry');--> statement-breakpoint
CREATE TABLE "customer_classifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "customer_classification_kind" NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_classifications_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "customer_classifications_name_not_blank" CHECK (btrim("customer_classifications"."name") <> ''),
	CONSTRAINT "customer_classifications_sequence_non_negative" CHECK ("customer_classifications"."sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "customer_type_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "industry_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_classifications" ADD CONSTRAINT "customer_classifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_classifications_organization_id_kind_name_key" ON "customer_classifications" USING btree ("organization_id","kind",lower("name"));--> statement-breakpoint
CREATE INDEX "customer_classifications_organization_id_kind_sequence_index" ON "customer_classifications" USING btree ("organization_id","kind","sequence");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_customer_type_id_fk" FOREIGN KEY ("organization_id","customer_type_id") REFERENCES "public"."customer_classifications"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_industry_id_fk" FOREIGN KEY ("organization_id","industry_id") REFERENCES "public"."customer_classifications"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_organization_id_customer_type_id_index" ON "customers" USING btree ("organization_id","customer_type_id");--> statement-breakpoint
CREATE INDEX "customers_organization_id_industry_id_index" ON "customers" USING btree ("organization_id","industry_id");--> statement-breakpoint
-- Data migration (#31): Customer Type and Industry become Organization-managed
-- value lists. Written by hand. Ids are UUIDv7, built in SQL (Postgres 17 has
-- no uuidv7()).
--
-- 1. Per Organization and list, one value per distinct free text: trimmed,
--    deduplicated ignoring case, the most common spelling winning (ties: the
--    first in sort order). Values are ordered by name.
INSERT INTO "customer_classifications" ("id", "organization_id", "kind", "name", "sequence")
SELECT
	encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
	chosen."organization_id",
	chosen."kind"::"customer_classification_kind",
	chosen."name",
	(row_number() OVER (PARTITION BY chosen."organization_id", chosen."kind" ORDER BY lower(chosen."name"), chosen."name") - 1)::integer
FROM (
	SELECT spellings.*, row_number() OVER (
		PARTITION BY spellings."organization_id", spellings."kind", lower(spellings."name")
		ORDER BY spellings."uses" DESC, spellings."name"
	) AS "rank"
	FROM (
		SELECT c."organization_id", v."kind", btrim(v."text") AS "name", count(*) AS "uses"
		FROM "customers" c
		CROSS JOIN LATERAL (VALUES ('customer_type', c."type"), ('industry', c."industry")) AS v("kind", "text")
		WHERE btrim(coalesce(v."text", '')) <> ''
		GROUP BY c."organization_id", v."kind", btrim(v."text")
	) spellings
) chosen
WHERE chosen."rank" = 1;
--> statement-breakpoint
-- 2. Point every Customer at the value of its text.
UPDATE "customers" c SET
	"customer_type_id" = (
		SELECT v."id" FROM "customer_classifications" v
		WHERE v."organization_id" = c."organization_id" AND v."kind" = 'customer_type'
			AND lower(v."name") = lower(btrim(c."type"))
	),
	"industry_id" = (
		SELECT v."id" FROM "customer_classifications" v
		WHERE v."organization_id" = c."organization_id" AND v."kind" = 'industry'
			AND lower(v."name") = lower(btrim(c."industry"))
	)
WHERE c."type" IS NOT NULL OR c."industry" IS NOT NULL;
--> statement-breakpoint
-- 3. An Organization with no values in a list gets that list's defaults
--    (`DEFAULT_CUSTOMER_CLASSIFICATIONS` in @workspace/domain/customers, as of
--    this migration).
INSERT INTO "customer_classifications" ("id", "organization_id", "kind", "name", "sequence")
SELECT
	encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
	o."id",
	d."kind"::"customer_classification_kind",
	d."name",
	d."sequence"
FROM "organizations" o
CROSS JOIN (VALUES
	('customer_type', 'Prospect', 0),
	('customer_type', 'Customer', 1),
	('customer_type', 'Partner', 2),
	('industry', 'Construction', 0),
	('industry', 'Education', 1),
	('industry', 'Energy & Utilities', 2),
	('industry', 'Financial Services', 3),
	('industry', 'Government', 4),
	('industry', 'Healthcare', 5),
	('industry', 'Manufacturing', 6),
	('industry', 'Media & Entertainment', 7),
	('industry', 'Nonprofit', 8),
	('industry', 'Professional Services', 9),
	('industry', 'Real Estate', 10),
	('industry', 'Retail', 11),
	('industry', 'Technology', 12),
	('industry', 'Telecommunications', 13),
	('industry', 'Transportation & Logistics', 14)
) AS d("kind", "name", "sequence")
WHERE NOT EXISTS (
	SELECT 1 FROM "customer_classifications" v
	WHERE v."organization_id" = o."id" AND v."kind"::text = d."kind"
)
ORDER BY o."id", d."kind", d."sequence";
