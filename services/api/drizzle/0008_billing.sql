CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_entries_kind_check" CHECK ("commission_entries"."kind" IN ('ACCRUED', 'ADJUSTMENT')),
	CONSTRAINT "commission_entries_order_check" CHECK ("commission_entries"."kind" <> 'ACCRUED' OR "commission_entries"."order_id" IS NOT NULL),
	CONSTRAINT "commission_entries_amount_check" CHECK ("commission_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"reason" text,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_plans_code_check" CHECK ("merchant_plans"."plan_code" IN ('EMPRENDEDOR', 'NEGOCIO', 'PRO'))
);
--> statement-breakpoint
CREATE TABLE "pricing_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"brackets" jsonb NOT NULL,
	"caps_by_category" jsonb NOT NULL,
	"plans" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_version_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_plan" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_category" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_basis_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_detail" jsonb;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_plans" ADD CONSTRAINT "merchant_plans_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_entries_accrued_unique" ON "commission_entries" USING btree ("order_id") WHERE "commission_entries"."kind" = 'ACCRUED';--> statement-breakpoint
CREATE INDEX "commission_entries_merchant_idx" ON "commission_entries" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_plans_current_unique" ON "merchant_plans" USING btree ("merchant_id") WHERE "merchant_plans"."ends_at" IS NULL;--> statement-breakpoint
CREATE INDEX "merchant_plans_merchant_idx" ON "merchant_plans" USING btree ("merchant_id","starts_at");--> statement-breakpoint
-- Versión inicial de pricing: hipótesis comercial v0.4 de la SPEC §6.1–6.2 (precios a validar).
INSERT INTO "pricing_versions" ("id", "brackets", "caps_by_category", "plans", "effective_from", "notes") VALUES (
  'v0.4-hypothesis',
  '[{"upToMinor":3000000,"rateFactorBps":10000},{"upToMinor":10000000,"rateFactorBps":7000},{"upToMinor":null,"rateFactorBps":4000}]',
  '{"GASTRONOMY":500000,"KIOSK":400000,"SUPERMARKET":500000,"ELECTRONICS":700000,"ENTREPRENEUR":500000}',
  '{"EMPRENDEDOR":{"monthlyFeeMinor":0,"baseRateBps":600,"maxBranches":1,"maxUsers":1},"NEGOCIO":{"monthlyFeeMinor":2500000,"baseRateBps":400,"maxBranches":1,"maxUsers":3},"PRO":{"monthlyFeeMinor":6000000,"baseRateBps":250,"maxBranches":3,"maxUsers":6}}',
  '2026-01-01T00:00:00Z',
  'Hipótesis comercial v0.4 (SPEC §6). No son precios aprobados.'
) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Ledger append-only: nunca se editan ni borran asientos (SPEC §6.3).
CREATE OR REPLACE FUNCTION "commission_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commission_entries es append-only: usá un asiento compensatorio';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commission_entries_no_update_delete" BEFORE UPDATE OR DELETE ON "commission_entries"
  FOR EACH ROW EXECUTE FUNCTION "commission_entries_append_only"();--> statement-breakpoint
-- La Data API de Supabase queda cerrada, como en el resto de las tablas.
ALTER TABLE "pricing_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_entries" ENABLE ROW LEVEL SECURITY;
