CREATE TABLE "cost_change_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_name" text NOT NULL,
	"old_cost" numeric(19, 4) NOT NULL,
	"new_cost" numeric(19, 4) NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_change_log_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "cost_change_log_costs_non_negative" CHECK ("cost_change_log"."old_cost" >= 0 and "cost_change_log"."new_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cost_change_log" ADD CONSTRAINT "cost_change_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_change_log" ADD CONSTRAINT "cost_change_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_change_log" ADD CONSTRAINT "cost_change_log_quote_id_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_change_log" ADD CONSTRAINT "cost_change_log_line_item_id_fk" FOREIGN KEY ("organization_id","line_item_id") REFERENCES "public"."line_items"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_change_log_organization_id_quote_id_created_at_index" ON "cost_change_log" USING btree ("organization_id","quote_id","created_at");