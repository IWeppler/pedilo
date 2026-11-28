CREATE TABLE "merchant_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_code" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_ratings_stars_check" CHECK ("merchant_ratings"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "merchant_ratings_comment_check" CHECK ("merchant_ratings"."comment" IS NULL OR char_length("merchant_ratings"."comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "merchant_ratings" ADD CONSTRAINT "merchant_ratings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_ratings_order_unique" ON "merchant_ratings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "merchant_ratings_merchant_idx" ON "merchant_ratings" USING btree ("merchant_id","created_at");--> statement-breakpoint
-- RLS sin políticas, como el resto de las tablas (0004): bloquea la Data API de Supabase.
ALTER TABLE "merchant_ratings" ENABLE ROW LEVEL SECURITY;
