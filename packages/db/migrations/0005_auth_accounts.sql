-- Auth.js's OAuth "accounts" table becomes "auth_accounts": in CPQ Express
-- "accounts" is the business Account (glossary), a table of its own.
ALTER TABLE "accounts" RENAME TO "auth_accounts";--> statement-breakpoint
ALTER TABLE "auth_accounts" RENAME CONSTRAINT "accounts_provider_provider_account_id_pk" TO "auth_accounts_provider_provider_account_id_pk";--> statement-breakpoint
ALTER TABLE "auth_accounts" RENAME CONSTRAINT "accounts_user_id_users_id_fk" TO "auth_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER INDEX "accounts_user_id_index" RENAME TO "auth_accounts_user_id_index";
