ALTER TABLE "customer_profiles" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_notes" text;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_lat" double precision;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_lng" double precision;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_location_check" CHECK (("customer_profiles"."address_lat" IS NULL AND "customer_profiles"."address_lng" IS NULL) OR ("customer_profiles"."address_lat" BETWEEN -90 AND 90 AND "customer_profiles"."address_lng" BETWEEN -180 AND 180));