ALTER TABLE "teams" ADD COLUMN "review_overdue_notify_user_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "close_reviews_on_newer_build" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "re_request_on_newer_build" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "auto_approve_no_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "require_reject_reason" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "flaky_after_changes" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "snooze_default_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_review_overdue_notify_user_id_user_id_fk" FOREIGN KEY ("review_overdue_notify_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_flaky_after_changes_check" CHECK ("teams"."flaky_after_changes" between 1 and 10);--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_snooze_default_days_check" CHECK ("teams"."snooze_default_days" between 1 and 30);