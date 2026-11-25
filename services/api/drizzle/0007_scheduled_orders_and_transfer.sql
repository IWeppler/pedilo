ALTER TABLE "branches" ADD COLUMN "scheduling_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "schedule_lead_minutes" smallint DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "schedule_max_days" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "slot_capacity" smallint;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "accepts_cash" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "accepts_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "transfer_alias" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "transfer_cbu" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "transfer_holder" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transfer_details" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_confirmed_by" uuid;--> statement-breakpoint
CREATE INDEX "orders_branch_slot_idx" ON "orders" USING btree ("branch_id","scheduled_for") WHERE "orders"."scheduled_for" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_scheduling_check" CHECK ("branches"."schedule_lead_minutes" BETWEEN 15 AND 2880 AND "branches"."schedule_max_days" BETWEEN 1 AND 14 AND ("branches"."slot_capacity" IS NULL OR "branches"."slot_capacity" >= 1));--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_payment_method_check" CHECK ("merchants"."accepts_cash" OR "merchants"."accepts_transfer");--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_transfer_details_check" CHECK (NOT "merchants"."accepts_transfer" OR (("merchants"."transfer_alias" IS NOT NULL OR "merchants"."transfer_cbu" IS NOT NULL) AND "merchants"."transfer_holder" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_method_check" CHECK ("orders"."payment_method" IN ('CASH', 'TRANSFER', 'MERCADO_PAGO'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_transfer_details_check" CHECK ("orders"."payment_method" <> 'TRANSFER' OR "orders"."transfer_details" IS NOT NULL);