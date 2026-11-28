CREATE TABLE "promotion_products" (
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "promotion_products_promotion_id_product_id_pk" PRIMARY KEY("promotion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"discount_minor" integer NOT NULL,
	"status" text DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "promotion_redemptions_status_check" CHECK ("promotion_redemptions"."status" IN ('APPLIED', 'REVERSED')),
	CONSTRAINT "promotion_redemptions_discount_check" CHECK ("promotion_redemptions"."discount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"discount_type" text NOT NULL,
	"value" integer NOT NULL,
	"all_products" boolean DEFAULT true NOT NULL,
	"min_subtotal_minor" integer DEFAULT 0 NOT NULL,
	"max_discount_minor" integer,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"per_customer_limit" integer,
	"redemptions_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_kind_check" CHECK ("promotions"."kind" IN ('OFFER', 'COUPON')),
	CONSTRAINT "promotions_code_check" CHECK (("promotions"."kind" = 'COUPON') = ("promotions"."code" IS NOT NULL)),
	CONSTRAINT "promotions_discount_type_check" CHECK ("promotions"."discount_type" IN ('PERCENT', 'FIXED')),
	CONSTRAINT "promotions_value_check" CHECK (("promotions"."discount_type" = 'PERCENT' AND "promotions"."value" BETWEEN 1 AND 90) OR ("promotions"."discount_type" = 'FIXED' AND "promotions"."value" > 0)),
	CONSTRAINT "promotions_limits_check" CHECK ("promotions"."min_subtotal_minor" >= 0 AND ("promotions"."max_discount_minor" IS NULL OR "promotions"."max_discount_minor" > 0)),
	CONSTRAINT "promotions_redemptions_check" CHECK ("promotions"."redemptions_count" >= 0 AND ("promotions"."max_redemptions" IS NULL OR "promotions"."max_redemptions" > 0) AND ("promotions"."per_customer_limit" IS NULL OR "promotions"."per_customer_limit" > 0)),
	CONSTRAINT "promotions_dates_check" CHECK ("promotions"."ends_at" IS NULL OR "promotions"."ends_at" > "promotions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promotion_label" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promotion_title" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_redemptions_order_unique" ON "promotion_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "promotion_redemptions_customer_idx" ON "promotion_redemptions" USING btree ("promotion_id","customer_user_id");--> statement-breakpoint
CREATE INDEX "promotions_merchant_idx" ON "promotions" USING btree ("merchant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_code_unique" ON "promotions" USING btree ("merchant_id","code") WHERE "promotions"."code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal_minor" >= 0 AND "orders"."delivery_fee_minor" >= 0 AND "orders"."discount_minor" BETWEEN 0 AND "orders"."subtotal_minor" AND "orders"."total_minor" = "orders"."subtotal_minor" - "orders"."discount_minor" + "orders"."delivery_fee_minor");--> statement-breakpoint
-- RLS sin políticas, como el resto de las tablas (0004): bloquea la Data API de Supabase.
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ENABLE ROW LEVEL SECURITY;
