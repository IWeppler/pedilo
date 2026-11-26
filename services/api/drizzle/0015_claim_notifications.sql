CREATE TABLE "customer_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"expo_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "audience" text DEFAULT 'MERCHANT' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_push_tokens" ADD CONSTRAINT "customer_push_tokens_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_push_tokens_unique" ON "customer_push_tokens" USING btree ("order_id","expo_token");--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_audience_check" CHECK ("notification_outbox"."audience" <> 'CUSTOMER' OR "notification_outbox"."order_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "customer_push_tokens" ENABLE ROW LEVEL SECURITY;
