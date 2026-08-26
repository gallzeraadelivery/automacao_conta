CREATE TABLE IF NOT EXISTS "used_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"source" varchar(50) DEFAULT 'import' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "used_emails" ADD CONSTRAINT "used_emails_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "used_emails" ADD CONSTRAINT "used_emails_company_email_unique" UNIQUE ("company_id", "email");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "used_emails" ("company_id", "email", "source")
SELECT "company_id", lower("email"), 'backfill'
FROM "applicants"
ON CONFLICT ("company_id", "email") DO NOTHING;
