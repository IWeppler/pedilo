CREATE TABLE "branch_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_closures_range_check" CHECK ("branch_closures"."ends_on" >= "branch_closures"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_closures_branch_idx" ON "branch_closures" USING btree ("branch_id","ends_on");--> statement-breakpoint
ALTER TABLE "branch_closures" ENABLE ROW LEVEL SECURITY;
