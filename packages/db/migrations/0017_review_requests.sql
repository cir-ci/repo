CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"requested_by_id" text,
	"state" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"snooze_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "review_requests_state_check" CHECK (state in ('open', 'done', 'superseded', 'dismissed')),
	CONSTRAINT "review_requests_snooze_kind_check" CHECK (snooze_kind is null or snooze_kind in ('next_push', 'tomorrow', 'next_week', 'date'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "review_target_hours" integer DEFAULT 24;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_open_key" ON "review_requests" USING btree ("build_id","reviewer_id") WHERE "review_requests"."state" = 'open';--> statement-breakpoint
CREATE INDEX "review_requests_reviewer_idx" ON "review_requests" USING btree ("reviewer_id","state");--> statement-breakpoint
CREATE INDEX "review_requests_requester_idx" ON "review_requests" USING btree ("requested_by_id","state");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_review_target_hours_check" CHECK ("projects"."review_target_hours" is null or "projects"."review_target_hours" >= 1);