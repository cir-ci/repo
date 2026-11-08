CREATE TABLE "snapshot_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"snapshot_name" text NOT NULL,
	"decision" text NOT NULL,
	"user_id" text,
	"source" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "snapshot_reviews_decision_check" CHECK (decision in ('approved', 'rejected')),
	CONSTRAINT "snapshot_reviews_source_check" CHECK (source in ('ui', 'github-check', 'github-comment', 'gitlab-comment', 'gitlab-status', 'bitbucket-comment', 'bitbucket-status', 'auto', 'rerun'))
);
--> statement-breakpoint
ALTER TABLE "snapshot_reviews" ADD CONSTRAINT "snapshot_reviews_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_reviews" ADD CONSTRAINT "snapshot_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_reviews_current_key" ON "snapshot_reviews" USING btree ("build_id","snapshot_name") WHERE "snapshot_reviews"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "snapshot_reviews_build_idx" ON "snapshot_reviews" USING btree ("build_id","created_at");