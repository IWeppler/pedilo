CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"name" text,
	"line" text NOT NULL,
	"notes" text,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_label_check" CHECK ("customer_addresses"."label" IN ('HOME', 'WORK', 'OTHER')),
	CONSTRAINT "customer_addresses_location_check" CHECK (("customer_addresses"."lat" IS NULL AND "customer_addresses"."lng" IS NULL) OR ("customer_addresses"."lat" BETWEEN -90 AND 90 AND "customer_addresses"."lng" BETWEEN -180 AND 180))
);
--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP CONSTRAINT "customer_profiles_location_check";--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_user_id_customer_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_user_idx" ON "customer_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_label_unique" ON "customer_addresses" USING btree ("user_id","label") WHERE "customer_addresses"."label" IN ('HOME', 'WORK');--> statement-breakpoint
-- La dirección única que tenía cada cliente pasa a ser su «Casa» (ADR 0034).
INSERT INTO "customer_addresses" ("user_id", "label", "line", "notes", "lat", "lng")
SELECT "user_id", 'HOME', "address_line", "address_notes", "address_lat", "address_lng"
FROM "customer_profiles" WHERE "address_line" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP COLUMN "address_line";--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP COLUMN "address_notes";--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP COLUMN "address_lat";--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP COLUMN "address_lng";--> statement-breakpoint
-- RLS sin políticas, como el resto de las tablas (0004): bloquea la Data API de Supabase.
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;
