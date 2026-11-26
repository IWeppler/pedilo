CREATE TABLE "courier_merchant_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"courier_id" uuid NOT NULL,
	"delivery_id" uuid,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_merchant_entries_kind_check" CHECK ("courier_merchant_entries"."kind" IN ('DELIVERY_FEE', 'CASH_COLLECTED', 'PAYMENT')),
	CONSTRAINT "courier_merchant_entries_amount_check" CHECK ("courier_merchant_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "pin_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "dropoff_pin" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "pin_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_merchant_entries" ADD CONSTRAINT "courier_merchant_entries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_merchant_entries" ADD CONSTRAINT "courier_merchant_entries_courier_id_courier_profiles_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_merchant_entries" ADD CONSTRAINT "courier_merchant_entries_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_merchant_entries_pair_idx" ON "courier_merchant_entries" USING btree ("merchant_id","courier_id","created_at");--> statement-breakpoint
CREATE INDEX "courier_merchant_entries_courier_idx" ON "courier_merchant_entries" USING btree ("courier_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_merchant_entries_delivery_unique" ON "courier_merchant_entries" USING btree ("delivery_id","kind") WHERE "courier_merchant_entries"."delivery_id" IS NOT NULL AND "courier_merchant_entries"."kind" <> 'PAYMENT';--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pin_check" CHECK (NOT "deliveries"."pin_required" OR "deliveries"."dropoff_pin" ~ '^[0-9]{4}$');--> statement-breakpoint
-- Cuenta comercio↔repartidor append-only (usa la función de 0009).
CREATE TRIGGER "courier_merchant_entries_no_update_delete" BEFORE UPDATE OR DELETE ON "courier_merchant_entries"
  FOR EACH ROW EXECUTE FUNCTION "billing_append_only"();--> statement-breakpoint
ALTER TABLE "courier_merchant_entries" ENABLE ROW LEVEL SECURITY;
