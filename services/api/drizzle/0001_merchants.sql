CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line" text NOT NULL,
	"address_notes" text,
	"lat" double precision,
	"lng" double precision,
	"phone" text,
	"timezone" text NOT NULL,
	"accepts_pickup" boolean DEFAULT true NOT NULL,
	"accepts_delivery" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_lat_lng_check" CHECK (("branches"."lat" IS NULL AND "branches"."lng" IS NULL) OR ("branches"."lat" BETWEEN -90 AND 90 AND "branches"."lng" BETWEEN -180 AND 180))
);
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" smallint NOT NULL,
	"closes_at" smallint NOT NULL,
	CONSTRAINT "business_hours_weekday_check" CHECK ("business_hours"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "business_hours_range_check" CHECK ("business_hours"."opens_at" BETWEEN 0 AND 1440 AND "business_hours"."closes_at" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fee_minor" integer NOT NULL,
	"min_order_minor" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_amounts_check" CHECK ("delivery_zones"."fee_minor" >= 0 AND "delivery_zones"."min_order_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_members_role_check" CHECK ("merchant_members"."role" IN ('OWNER', 'OPERATOR'))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"tax_id" text NOT NULL,
	"slug" text NOT NULL,
	"category_id" uuid NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"rejection_reason" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_status_check" CHECK ("merchants"."status" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
	CONSTRAINT "merchants_tax_id_check" CHECK ("merchants"."tax_id" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branches_merchant_idx" ON "branches" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "branches_city_idx" ON "branches" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "business_hours_branch_idx" ON "business_hours" USING btree ("branch_id","weekday");--> statement-breakpoint
CREATE INDEX "delivery_zones_branch_idx" ON "delivery_zones" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_members_unique" ON "merchant_members" USING btree ("merchant_id","user_id");--> statement-breakpoint
CREATE INDEX "merchant_members_user_idx" ON "merchant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_slug_unique" ON "merchants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "merchants_status_idx" ON "merchants" USING btree ("status","submitted_at");