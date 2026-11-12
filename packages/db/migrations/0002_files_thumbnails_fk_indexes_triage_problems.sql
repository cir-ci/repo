CREATE TABLE "triage_problems" (
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "triage_problems_project_id_kind_key_pk" PRIMARY KEY("project_id","kind","key"),
	CONSTRAINT "triage_problems_kind_check" CHECK (kind in ('flaky', 'no_baseline', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "thumbnail_sha256" text;--> statement-breakpoint
ALTER TABLE "triage_problems" ADD CONSTRAINT "triage_problems_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_thumbnail_sha256_files_sha256_fk" FOREIGN KEY ("thumbnail_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builds_base_build_idx" ON "builds" USING btree ("base_build_id");--> statement-breakpoint
CREATE INDEX "builds_author_user_idx" ON "builds" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "files_thumbnail_idx" ON "files" USING btree ("thumbnail_sha256");--> statement-breakpoint
CREATE INDEX "integration_projects_project_idx" ON "integration_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notifications_actor_idx" ON "notifications" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "reviews_user_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "snapshot_reviews_user_idx" ON "snapshot_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_base_screenshot_idx" ON "screenshot_diffs" USING btree ("base_screenshot_id");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_head_screenshot_idx" ON "screenshot_diffs" USING btree ("head_screenshot_id");--> statement-breakpoint
CREATE INDEX "site_hostnames_static_site_idx" ON "site_hostnames" USING btree ("static_site_id");--> statement-breakpoint
CREATE INDEX "site_sessions_user_idx" ON "site_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_sessions_auth_session_idx" ON "site_sessions" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "site_tokens_user_idx" ON "site_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_tokens_auth_session_idx" ON "site_tokens" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "triage_rotation_members_user_idx" ON "triage_rotation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "undo_actions_project_idx" ON "undo_actions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "saved_views_workspace_idx" ON "saved_views" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "saved_views_project_idx" ON "saved_views" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "user_pinned_projects_project_idx" ON "user_pinned_projects" USING btree ("project_id");