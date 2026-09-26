ALTER TABLE "organization_settings" DROP CONSTRAINT "organization_settings_deletable_statuses_uncommitted";--> statement-breakpoint
DROP INDEX "quotes_organization_id_status_index";--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "stage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_steps" ALTER COLUMN "from_stage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_steps" ALTER COLUMN "to_stage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_steps" ALTER COLUMN "from_status_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_steps" ALTER COLUMN "to_status_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status_id_fk" FOREIGN KEY ("organization_id","status_id","stage") REFERENCES "public"."quote_statuses"("organization_id","id","stage") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_organization_id_stage_index" ON "quotes" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "quotes_organization_id_status_id_index" ON "quotes" USING btree ("organization_id","status_id");--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN "deletable_statuses";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "approval_steps" DROP COLUMN "from_status";--> statement-breakpoint
ALTER TABLE "approval_steps" DROP COLUMN "to_status";--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_deletable_stages_allowed" CHECK ("organization_settings"."deletable_stages" <@ array['draft', 'lost']::quote_stage[]);--> statement-breakpoint
DROP TYPE "public"."quote_status";