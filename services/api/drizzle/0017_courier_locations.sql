CREATE TABLE "courier_locations" (
	"courier_id" uuid PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" integer,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_locations_lat_lng_check" CHECK ("courier_locations"."lat" BETWEEN -90 AND 90 AND "courier_locations"."lng" BETWEEN -180 AND 180),
	CONSTRAINT "courier_locations_accuracy_check" CHECK ("courier_locations"."accuracy_m" IS NULL OR "courier_locations"."accuracy_m" >= 0)
);
--> statement-breakpoint
ALTER TABLE "courier_locations" ADD CONSTRAINT "courier_locations_courier_id_courier_profiles_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_profiles"("id") ON DELETE cascade ON UPDATE no action;