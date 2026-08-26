ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "proxy_external_ip" varchar(45);
--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "proxy_geo_city" varchar(100);
--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "proxy_geo_region" varchar(100);
--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "proxy_geo_looked_up_at" timestamp;
