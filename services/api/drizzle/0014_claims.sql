CREATE TABLE "claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"body" text,
	"amount_minor" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"image_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_code" text NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"merchant_due_at" timestamp with time zone NOT NULL,
	"proposal_type" text,
	"proposal_amount_minor" integer,
	"proposal_note" text,
	"proposed_at" timestamp with time zone,
	"refunded_minor" integer,
	"refunded_at" timestamp with time zone,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_reason_check" CHECK ("claims"."reason" IN ('MISSING_ITEM', 'WRONG_ITEM', 'QUALITY', 'DELAY', 'NOT_DELIVERED', 'WRONG_CHARGE')),
	CONSTRAINT "claims_amounts_check" CHECK (coalesce("claims"."proposal_amount_minor", 0) >= 0 AND coalesce("claims"."refunded_minor", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_events_claim_idx" ON "claim_events" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_order_unique" ON "claims" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "claims_merchant_idx" ON "claims" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "claims_due_idx" ON "claims" USING btree ("merchant_due_at") WHERE "claims"."status" = 'OPEN';--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_evidence" ENABLE ROW LEVEL SECURITY;
