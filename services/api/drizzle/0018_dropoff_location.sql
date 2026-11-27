ALTER TABLE "orders" ADD COLUMN "delivery_lat" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lng" double precision;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "dropoff_lat" double precision;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "dropoff_lng" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_location_check" CHECK (("orders"."delivery_lat" IS NULL AND "orders"."delivery_lng" IS NULL) OR ("orders"."delivery_lat" BETWEEN -90 AND 90 AND "orders"."delivery_lng" BETWEEN -180 AND 180));--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_dropoff_location_check" CHECK (("deliveries"."dropoff_lat" IS NULL AND "deliveries"."dropoff_lng" IS NULL) OR ("deliveries"."dropoff_lat" BETWEEN -90 AND 90 AND "deliveries"."dropoff_lng" BETWEEN -180 AND 180));