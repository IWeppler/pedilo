CREATE TABLE "merchant_mp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"mp_user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"live_mode" boolean NOT NULL,
	"scope" text,
	"status" text DEFAULT 'CONNECTED' NOT NULL,
	"connected_by" uuid NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_mp_accounts_status_check" CHECK ("merchant_mp_accounts"."status" IN ('CONNECTED', 'NEEDS_REAUTH'))
);
--> statement-breakpoint
CREATE TABLE "mp_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"topic" text NOT NULL,
	"data_id" text NOT NULL,
	"mp_user_id" text,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"provider" text DEFAULT 'MERCADO_PAGO' NOT NULL,
	"provider_payment_id" text,
	"status" text NOT NULL,
	"provider_status" text,
	"provider_status_detail" text,
	"amount_minor" integer NOT NULL,
	"application_fee_minor" integer NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amounts_check" CHECK ("payments"."amount_minor" > 0 AND "payments"."application_fee_minor" >= 0 AND "payments"."application_fee_minor" < "payments"."amount_minor" AND "payments"."refunded_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"claim_id" uuid,
	"amount_minor" integer,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" IN ('PENDING', 'APPROVED', 'FAILED')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_minor" IS NULL OR "refunds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "accepts_mercado_pago" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_mp_accounts" ADD CONSTRAINT "merchant_mp_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_oauth_states" ADD CONSTRAINT "mp_oauth_states_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_mp_accounts_merchant_unique" ON "merchant_mp_accounts" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_oauth_states_state_unique" ON "mp_oauth_states" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_webhook_events_request_unique" ON "mp_webhook_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_id_unique" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_unique" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_unique" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_pending_idx" ON "refunds" USING btree ("next_attempt_at") WHERE "refunds"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "mp_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_mp_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mp_webhook_events" ENABLE ROW LEVEL SECURITY;
