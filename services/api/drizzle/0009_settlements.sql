CREATE TABLE "settlement_allocations" (
	"settlement_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_payments_amount_check" CHECK ("settlement_payments"."amount_minor" > 0),
	CONSTRAINT "settlement_payments_method_check" CHECK ("settlement_payments"."method" IN ('TRANSFER', 'CASH', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_minor" integer NOT NULL,
	"entry_count" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_total_check" CHECK ("settlements"."total_minor" > 0 AND "settlements"."entry_count" > 0),
	CONSTRAINT "settlements_period_check" CHECK ("settlements"."period_start" < "settlements"."period_end" AND "settlements"."due_at" > "settlements"."period_end")
);
--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_entry_id_commission_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."commission_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_allocations_entry_unique" ON "settlement_allocations" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "settlement_allocations_settlement_idx" ON "settlement_allocations" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_payments_settlement_idx" ON "settlement_payments" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_merchant_period_unique" ON "settlements" USING btree ("merchant_id","period_end");--> statement-breakpoint
CREATE INDEX "settlements_due_idx" ON "settlements" USING btree ("due_at");--> statement-breakpoint
-- Liquidaciones, asignaciones y pagos son append-only (SPEC §8.4: asientos correctivos inmutables).
CREATE OR REPLACE FUNCTION "billing_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "settlements_no_update_delete" BEFORE UPDATE OR DELETE ON "settlements"
  FOR EACH ROW EXECUTE FUNCTION "billing_append_only"();--> statement-breakpoint
CREATE TRIGGER "settlement_allocations_no_update_delete" BEFORE UPDATE OR DELETE ON "settlement_allocations"
  FOR EACH ROW EXECUTE FUNCTION "billing_append_only"();--> statement-breakpoint
CREATE TRIGGER "settlement_payments_no_update_delete" BEFORE UPDATE OR DELETE ON "settlement_payments"
  FOR EACH ROW EXECUTE FUNCTION "billing_append_only"();--> statement-breakpoint
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_payments" ENABLE ROW LEVEL SECURITY;
