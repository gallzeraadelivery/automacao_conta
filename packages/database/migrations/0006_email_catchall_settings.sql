ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "signup_email_domain" varchar(255);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "signup_email_provider" varchar(50);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "catchall_inbox_email" varchar(255);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "catchall_domains" text;
