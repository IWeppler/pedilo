ALTER TABLE "orders" ADD COLUMN "accept_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_accept_deadline_idx" ON "orders" USING btree ("accept_deadline_at") WHERE "orders"."status" = 'PLACED';