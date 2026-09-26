-- Glossary: Account is now Customer (and the Organization's own "Company"
-- settings are the Organization profile). Pure renames, so no data moves,
-- then the two places that store the old words as data.
ALTER TABLE "accounts" RENAME TO "customers";
--> statement-breakpoint
ALTER INDEX "accounts_organization_id_archived_index" RENAME TO "customers_organization_id_archived_index";
--> statement-breakpoint
ALTER INDEX "accounts_organization_id_name_key" RENAME TO "customers_organization_id_name_key";
--> statement-breakpoint
ALTER TABLE "customers" RENAME CONSTRAINT "accounts_organization_id_organizations_id_fk" TO "customers_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "customers" RENAME CONSTRAINT "accounts_organization_id_id_key" TO "customers_organization_id_id_key";
--> statement-breakpoint
ALTER TABLE "contacts" RENAME COLUMN "account_id" TO "customer_id";
--> statement-breakpoint
ALTER INDEX "contacts_one_primary_per_account" RENAME TO "contacts_one_primary_per_customer";
--> statement-breakpoint
ALTER INDEX "contacts_organization_id_account_id_index" RENAME TO "contacts_organization_id_customer_id_index";
--> statement-breakpoint
ALTER TABLE "contacts" RENAME CONSTRAINT "contacts_account_id_fk" TO "contacts_customer_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" RENAME COLUMN "account_id" TO "customer_id";
--> statement-breakpoint
ALTER INDEX "quotes_organization_id_account_id_name_index" RENAME TO "quotes_organization_id_customer_id_name_index";
--> statement-breakpoint
ALTER TABLE "quotes" RENAME CONSTRAINT "quotes_account_id_fk" TO "quotes_customer_id_fk";
--> statement-breakpoint
-- Saved Quote list layouts name the column by id.
UPDATE "user_preferences" SET "quote_list_columns" = array_replace("quote_list_columns", 'account', 'customer'), "quote_list_hidden_columns" = array_replace("quote_list_hidden_columns", 'account', 'customer');
--> statement-breakpoint
-- Stored Quote Document snapshots: the seller block `company` is now `profile`, the Bill To `account` is now `customer`.
UPDATE "quote_documents" SET "quote_snapshot" = ("quote_snapshot" - 'company' - 'account') || jsonb_build_object('profile', "quote_snapshot" -> 'company', 'customer', "quote_snapshot" -> 'account') WHERE "quote_snapshot" ? 'account';
