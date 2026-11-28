CREATE TABLE "courier_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"expo_token" text NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "courier_id" uuid;--> statement-breakpoint
ALTER TABLE "courier_push_tokens" ADD CONSTRAINT "courier_push_tokens_courier_id_courier_profiles_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_push_tokens_token_unique" ON "courier_push_tokens" USING btree ("expo_token");--> statement-breakpoint
CREATE INDEX "courier_push_tokens_courier_idx" ON "courier_push_tokens" USING btree ("courier_id");--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_courier_id_courier_profiles_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_courier_check" CHECK ("notification_outbox"."audience" <> 'COURIER' OR "notification_outbox"."courier_id" IS NOT NULL);--> statement-breakpoint
-- RLS sin políticas, como el resto de las tablas (0004): bloquea la Data API de Supabase.
ALTER TABLE "courier_push_tokens" ENABLE ROW LEVEL SECURITY;
