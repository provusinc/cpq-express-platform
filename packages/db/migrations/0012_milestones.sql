CREATE TYPE "public"."milestone_type" AS ENUM('milestone', 'deadline', 'review', 'payment_due', 'custom');--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"type" "milestone_type" DEFAULT 'milestone' NOT NULL,
	"colour" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "milestones_colour_hex" CHECK ("milestones"."colour" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "milestones_name_not_blank" CHECK (btrim("milestones"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_quote_id_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestones_organization_id_quote_id_date_index" ON "milestones" USING btree ("organization_id","quote_id","date");