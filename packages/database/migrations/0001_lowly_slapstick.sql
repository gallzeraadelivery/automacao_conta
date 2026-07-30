CREATE TABLE IF NOT EXISTS "driver_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_by_operator_id" uuid,
	"expires_at" timestamp NOT NULL,
	"opened_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_deliveries_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "current_step" varchar(100);--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "profile_photo_confidence" varchar(20);--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "driver_license_confidence" varchar(20);--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "pause_reason" varchar(50);--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "resolved_by_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_deliveries" ADD CONSTRAINT "driver_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_deliveries" ADD CONSTRAINT "driver_deliveries_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_deliveries" ADD CONSTRAINT "driver_deliveries_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applicants" ADD CONSTRAINT "applicants_resolved_by_operator_id_operators_id_fk" FOREIGN KEY ("resolved_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
