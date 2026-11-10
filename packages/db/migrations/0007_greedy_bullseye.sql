ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "assign_triage_to_on_call" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "assign_triage_to_on_call" boolean;--> statement-breakpoint
ALTER TABLE "triage_items" ADD COLUMN "assignment_source" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('review_requested', 'review_re_requested', 'mentioned', 'build_approved', 'build_rejected', 'review_overdue', 'connection_needs_attention', 'flaky_detected', 'triage_assigned'));--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_assignment_source_check" CHECK (assignment_source is null or assignment_source in ('auto', 'manual'));