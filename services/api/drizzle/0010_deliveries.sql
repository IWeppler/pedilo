CREATE TABLE "courier_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle" text NOT NULL,
	"city_id" uuid NOT NULL,
	"min_fee_minor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
	"status_reason" text,
	"available" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_profiles_status_check" CHECK ("courier_profiles"."status" IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
	CONSTRAINT "courier_profiles_vehicle_check" CHECK ("courier_profiles"."vehicle" IN ('WALK', 'BIKE', 'MOTO', 'CAR')),
	CONSTRAINT "courier_profiles_min_fee_check" CHECK ("courier_profiles"."min_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"order_id" uuid,
	"reference" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pickup_name" text NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_phone" text,
	"dropoff_area" text NOT NULL,
	"dropoff_address" text NOT NULL,
	"dropoff_notes" text,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"package_description" text NOT NULL,
	"courier_fee_minor" integer NOT NULL,
	"tip_minor" integer DEFAULT 0 NOT NULL,
	"cash_to_collect_minor" integer DEFAULT 0 NOT NULL,
	"courier_id" uuid,
	"offer_expires_at" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_source_check" CHECK ("deliveries"."source" IN ('ORDER', 'MERCHANT_REQUEST')),
	CONSTRAINT "deliveries_order_check" CHECK ("deliveries"."source" <> 'ORDER' OR "deliveries"."order_id" IS NOT NULL),
	CONSTRAINT "deliveries_amounts_check" CHECK ("deliveries"."courier_fee_minor" >= 0 AND "deliveries"."tip_minor" >= 0 AND "deliveries"."cash_to_collect_minor" >= 0),
	CONSTRAINT "deliveries_courier_check" CHECK ("deliveries"."status" NOT IN ('ASSIGNED', 'ARRIVING_PICKUP', 'PICKED_UP', 'ARRIVING_DROPOFF', 'DELIVERED') OR "deliveries"."courier_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "delivery_declines" (
	"delivery_id" uuid NOT NULL,
	"courier_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_declines_delivery_id_courier_id_pk" PRIMARY KEY("delivery_id","courier_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"courier_id" uuid,
	"reason" text,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courier_profiles" ADD CONSTRAINT "courier_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_profiles" ADD CONSTRAINT "courier_profiles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courier_id_courier_profiles_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_declines" ADD CONSTRAINT "delivery_declines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_declines" ADD CONSTRAINT "delivery_declines_courier_id_courier_profiles_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_profiles_user_unique" ON "courier_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "courier_profiles_city_idx" ON "courier_profiles" USING btree ("city_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_active_unique" ON "deliveries" USING btree ("order_id") WHERE "deliveries"."order_id" IS NOT NULL AND "deliveries"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "deliveries_offers_idx" ON "deliveries" USING btree ("city_id","offer_expires_at") WHERE "deliveries"."status" = 'OFFERED';--> statement-breakpoint
CREATE INDEX "deliveries_courier_idx" ON "deliveries" USING btree ("courier_id","updated_at");--> statement-breakpoint
CREATE INDEX "deliveries_merchant_idx" ON "deliveries" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_events_delivery_idx" ON "delivery_events" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_events_event_unique" ON "delivery_events" USING btree ("event_id") WHERE "delivery_events"."event_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_declines" ENABLE ROW LEVEL SECURITY;
