CREATE TYPE "public"."quote_stage" AS ENUM('draft', 'in_approval', 'approved', 'with_customer', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "quote_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"stage" "quote_stage" NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"colour" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_statuses_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "quote_statuses_organization_id_id_stage_key" UNIQUE("organization_id","id","stage"),
	CONSTRAINT "quote_statuses_name_not_blank" CHECK (btrim("quote_statuses"."name") <> ''),
	CONSTRAINT "quote_statuses_sequence_non_negative" CHECK ("quote_statuses"."sequence" >= 0),
	CONSTRAINT "quote_statuses_colour_hex" CHECK ("quote_statuses"."colour" is null or "quote_statuses"."colour" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "deletable_stages" "quote_stage"[] DEFAULT '{draft}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "stage" "quote_stage";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "from_stage" "quote_stage";--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "to_stage" "quote_stage";--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "from_status_name" text;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "to_status_name" text;--> statement-breakpoint
ALTER TABLE "quote_statuses" ADD CONSTRAINT "quote_statuses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_statuses_organization_id_name_key" ON "quote_statuses" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "quote_statuses_organization_id_stage_sequence_index" ON "quote_statuses" USING btree ("organization_id","stage","sequence");--> statement-breakpoint
-- Data migration (#29, ADR-0004): the seven fixed Quote Statuses become six
-- fixed Quote Stages plus Organization-owned Quote Statuses. Written by hand.
-- Ids are UUIDv7, built in SQL (Postgres 17 has no uuidv7()).
--
-- 1. Every Organization gets the default Statuses, one per Stage.
INSERT INTO "quote_statuses" ("id", "organization_id", "stage", "name", "sequence")
SELECT
	encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
	o."id",
	d."stage"::"quote_stage",
	d."name",
	0
FROM "organizations" o
CROSS JOIN (VALUES
	(1, 'draft', 'Draft'),
	(2, 'in_approval', 'Pending Approval'),
	(3, 'approved', 'Approved'),
	(4, 'with_customer', 'Sent'),
	(5, 'won', 'Won'),
	(6, 'lost', 'Lost')
) AS d("position", "stage", "name")
ORDER BY o."id", d."position";
--> statement-breakpoint
-- 2. A rejected Quote becomes a Draft that is Rejected, which is read from
--    its latest Approval Step. Every rejection since the approval history
--    exists wrote that step; one without it gets it now, dated at the Quote's last
--    change, so the fact survives.
INSERT INTO "approval_steps" ("id", "organization_id", "quote_id", "action", "from_status", "to_status", "actor_id", "comment", "created_at")
SELECT
	encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
	q."organization_id",
	q."id",
	(CASE q."status" WHEN 'rejected' THEN 'reject' ELSE 'customer_rejected' END)::"approval_step_action",
	(CASE q."status" WHEN 'rejected' THEN 'pending_approval' ELSE 'pending_customer_approval' END)::"quote_status",
	q."status",
	q."updated_by_id",
	NULL,
	q."updated_at"
FROM "quotes" q
WHERE q."status" IN ('rejected', 'customer_rejected')
	AND (
		SELECT s."action"::text FROM "approval_steps" s
		WHERE s."organization_id" = q."organization_id" AND s."quote_id" = q."id"
		ORDER BY s."created_at" DESC, s."id" DESC
		LIMIT 1
	) IS DISTINCT FROM (CASE q."status" WHEN 'rejected' THEN 'reject' ELSE 'customer_rejected' END);
--> statement-breakpoint
-- 3. Quotes: Draft, Rejected and Customer Rejected → Draft; Pending Approval
--    → In Approval; Approved → Approved; Pending Customer Approval → With
--    Customer; Customer Approved → Won. Each lands on its Stage's Status.
UPDATE "quotes" SET "stage" = (CASE "status"
	WHEN 'draft' THEN 'draft'
	WHEN 'rejected' THEN 'draft'
	WHEN 'customer_rejected' THEN 'draft'
	WHEN 'pending_approval' THEN 'in_approval'
	WHEN 'approved' THEN 'approved'
	WHEN 'pending_customer_approval' THEN 'with_customer'
	WHEN 'customer_approved' THEN 'won'
END)::"quote_stage";
--> statement-breakpoint
UPDATE "quotes" q SET "status_id" = s."id"
FROM "quote_statuses" s
WHERE s."organization_id" = q."organization_id" AND s."stage" = q."stage";
--> statement-breakpoint
-- 4. Approval Steps keep their history, with the Stages (same mapping) and
--    the default Status name of each Stage as the name at the time.
UPDATE "approval_steps" SET
	"from_stage" = (CASE "from_status"
		WHEN 'draft' THEN 'draft'
		WHEN 'rejected' THEN 'draft'
		WHEN 'customer_rejected' THEN 'draft'
		WHEN 'pending_approval' THEN 'in_approval'
		WHEN 'approved' THEN 'approved'
		WHEN 'pending_customer_approval' THEN 'with_customer'
		WHEN 'customer_approved' THEN 'won'
	END)::"quote_stage",
	"to_stage" = (CASE "to_status"
		WHEN 'draft' THEN 'draft'
		WHEN 'rejected' THEN 'draft'
		WHEN 'customer_rejected' THEN 'draft'
		WHEN 'pending_approval' THEN 'in_approval'
		WHEN 'approved' THEN 'approved'
		WHEN 'pending_customer_approval' THEN 'with_customer'
		WHEN 'customer_approved' THEN 'won'
	END)::"quote_stage";
--> statement-breakpoint
UPDATE "approval_steps" SET
	"from_status_name" = (CASE "from_stage"
		WHEN 'draft' THEN 'Draft'
		WHEN 'in_approval' THEN 'Pending Approval'
		WHEN 'approved' THEN 'Approved'
		WHEN 'with_customer' THEN 'Sent'
		WHEN 'won' THEN 'Won'
		WHEN 'lost' THEN 'Lost'
	END),
	"to_status_name" = (CASE "to_stage"
		WHEN 'draft' THEN 'Draft'
		WHEN 'in_approval' THEN 'Pending Approval'
		WHEN 'approved' THEN 'Approved'
		WHEN 'with_customer' THEN 'Sent'
		WHEN 'won' THEN 'Won'
		WHEN 'lost' THEN 'Lost'
	END);
--> statement-breakpoint
-- 5. The deletable setting becomes per Stage: Draft is on when any of Draft,
--    Rejected or Customer Rejected was deletable; Lost starts off.
UPDATE "organization_settings" SET "deletable_stages" = (CASE
	WHEN "deletable_statuses" && ARRAY['draft', 'rejected', 'customer_rejected']::"quote_status"[] THEN '{draft}'
	ELSE '{}'
END)::"quote_stage"[];
