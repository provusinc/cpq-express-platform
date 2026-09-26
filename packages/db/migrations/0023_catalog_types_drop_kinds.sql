-- #30, hand-edited: Product / Add-on Label Overrides became the Catalog
-- Types' names (0022), so they go; line and cost log kinds collapse into
-- `catalog_item` (the line's Catalog Type is reached through its item).
DELETE FROM "label_overrides" WHERE "term" IN ('product', 'add_on');--> statement-breakpoint
ALTER TABLE "line_items" DROP CONSTRAINT "line_items_source_matches_kind";--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_product_billed_each";--> statement-breakpoint
ALTER TABLE "label_overrides" DROP CONSTRAINT "label_overrides_only_hideable_disabled";--> statement-breakpoint
ALTER TABLE "line_items" DROP CONSTRAINT "line_items_billing_unit_matches_kind";--> statement-breakpoint
ALTER TABLE "label_overrides" ALTER COLUMN "term" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."label_term";--> statement-breakpoint
CREATE TYPE "public"."label_term" AS ENUM('resource_role', 'phase');--> statement-breakpoint
ALTER TABLE "label_overrides" ALTER COLUMN "term" SET DATA TYPE "public"."label_term" USING "term"::"public"."label_term";--> statement-breakpoint
ALTER TABLE "line_items" ALTER COLUMN "source_kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cost_change_log" ALTER COLUMN "source_kind" SET DATA TYPE text;--> statement-breakpoint
UPDATE "line_items" SET "source_kind" = 'catalog_item' WHERE "source_kind" IN ('product', 'add_on');--> statement-breakpoint
UPDATE "cost_change_log" SET "source_kind" = 'catalog_item' WHERE "source_kind" IN ('product', 'add_on');--> statement-breakpoint
DROP TYPE "public"."source_kind";--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('catalog_item', 'resource_role');--> statement-breakpoint
ALTER TABLE "line_items" ALTER COLUMN "source_kind" SET DATA TYPE "public"."source_kind" USING "source_kind"::"public"."source_kind";--> statement-breakpoint
ALTER TABLE "cost_change_log" ALTER COLUMN "source_kind" SET DATA TYPE "public"."source_kind" USING "source_kind"::"public"."source_kind";--> statement-breakpoint
DROP INDEX "catalog_items_organization_id_kind_active_index";--> statement-breakpoint
ALTER TABLE "catalog_items" ALTER COLUMN "catalog_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "label_overrides" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_source_matches_kind" CHECK (("line_items"."source_kind" = 'resource_role' and "line_items"."resource_role_id" is not null and "line_items"."catalog_item_id" is null)
        or ("line_items"."source_kind" <> 'resource_role' and "line_items"."catalog_item_id" is not null and "line_items"."resource_role_id" is null));--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_billing_unit_matches_kind" CHECK ("line_items"."source_kind" <> 'resource_role' or "line_items"."billing_unit" = 'hour');--> statement-breakpoint
DROP TYPE "public"."catalog_item_kind";