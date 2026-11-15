CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_workspace_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"workspace_id" text,
	"domain" text NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "build_shards" (
	"build_id" uuid NOT NULL,
	"shard_index" text NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_shards_build_id_shard_index_pk" PRIMARY KEY("build_id","shard_index")
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text DEFAULT 'default' NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"pr_number" integer,
	"base_branch" text,
	"merge_base_sha" text,
	"ancestor_shas" text[] DEFAULT '{}'::text[] NOT NULL,
	"ancestry_status" text DEFAULT 'missing' NOT NULL,
	"history_source" text DEFAULT 'cli' NOT NULL,
	"baseline_source" text,
	"base_build_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text,
	"parallel_nonce" text,
	"parallel_total" integer,
	"conclusion" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"flaky_decision" jsonb,
	"error_message" text,
	"author_login" text,
	"author_email" text,
	"author_user_id" text,
	"finalized_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builds_status_check" CHECK (status in ('pending', 'uploading', 'processing', 'complete', 'error', 'expired')),
	CONSTRAINT "builds_review_status_check" CHECK (review_status in ('pending', 'approved', 'rejected')),
	CONSTRAINT "builds_ancestry_status_check" CHECK (ancestry_status in ('ok', 'missing', 'truncated')),
	CONSTRAINT "builds_conclusion_check" CHECK (conclusion is null or conclusion in ('no_changes', 'changes_detected')),
	CONSTRAINT "builds_baseline_source_check" CHECK (baseline_source is null or baseline_source in ('cli', 'sdk', 'provider', 'fallback', 'none')),
	CONSTRAINT "builds_parallel_check" CHECK (("builds"."parallel_nonce" is null) = ("builds"."parallel_total" is null) and ("builds"."parallel_total" is null or "builds"."parallel_total" >= 1))
);
--> statement-breakpoint
CREATE TABLE "commit_ancestry" (
	"project_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"merge_base_sha" text,
	"ancestor_shas" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commit_ancestry_project_id_commit_sha_pk" PRIMARY KEY("project_id","commit_sha")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"snapshot_name" text,
	"region_x" double precision,
	"region_y" double precision,
	"region_width" double precision,
	"region_height" double precision,
	"region_side" text DEFAULT 'current' NOT NULL,
	"body" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comments_region_check" CHECK (("comments"."region_x" is null and "comments"."region_y" is null and "comments"."region_width" is null and "comments"."region_height" is null)
        or ("comments"."snapshot_name" is not null
          and "comments"."region_x" >= 0 and "comments"."region_y" >= 0
          and "comments"."region_width" > 0 and "comments"."region_height" > 0
          and "comments"."region_x" + "comments"."region_width" <= 1 and "comments"."region_y" + "comments"."region_height" <= 1))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"sha256" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"size" bigint,
	"width" integer,
	"height" integer,
	"thumbnail_sha256" text,
	"content_type" text,
	"verified_at" timestamp with time zone,
	"gc_marked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "files_sha256_check" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_kind_check" CHECK (kind in ('screenshot', 'diff', 'thumbnail', 'asset')),
	CONSTRAINT "files_status_check" CHECK (status in ('pending', 'verified')),
	CONSTRAINT "files_verified_check" CHECK (("files"."status" = 'verified') = ("files"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "upload_claims" (
	"build_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_claims_build_id_file_sha256_pk" PRIMARY KEY("build_id","file_sha256")
);
--> statement-breakpoint
CREATE TABLE "build_checks" (
	"build_id" uuid PRIMARY KEY NOT NULL,
	"check_run_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_comments" (
	"project_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"comment_id" text NOT NULL,
	CONSTRAINT "pr_comments_project_id_pr_number_pk" PRIMARY KEY("project_id","pr_number")
);
--> statement-breakpoint
CREATE TABLE "provider_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"project_id" uuid,
	"build_id" uuid,
	"subject" text,
	"kind" text NOT NULL,
	"external_ref" text NOT NULL,
	"url" text,
	"title" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_projects_key" UNIQUE("integration_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text NOT NULL,
	"encrypted_credentials" text,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"needs_attention_reason" text,
	"needs_attention_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_workspace_kind_external_key" UNIQUE("workspace_id","kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"queue" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status_check" CHECK (status in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_review_requested" boolean DEFAULT true NOT NULL,
	"email_review_overdue" boolean DEFAULT true NOT NULL,
	"push_review_requested" boolean DEFAULT true NOT NULL,
	"push_mentioned" boolean DEFAULT true NOT NULL,
	"push_review_outcome" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"build_id" uuid,
	"project_id" uuid,
	"workspace_id" text,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK (kind in ('review_requested', 'review_re_requested', 'mentioned', 'build_approved', 'build_rejected', 'review_overdue', 'connection_needs_attention', 'flaky_detected', 'triage_assigned'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "session_methods" (
	"session_id" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"scope_workspace_id" text,
	CONSTRAINT "session_methods_method_check" CHECK (method in ('password', 'email', 'oidc', 'workspace-oidc'))
);
--> statement-breakpoint
CREATE TABLE "workspace_auth_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"email_login_enabled" boolean DEFAULT true NOT NULL,
	"password_login_enabled" boolean DEFAULT true NOT NULL,
	"signin_github" boolean DEFAULT true NOT NULL,
	"signin_google" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_deletions" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "workspace_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"auto_join_role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domains_auto_join_role_check" CHECK (auto_join_role in ('member'))
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"flaky_blocks_merge" boolean DEFAULT true NOT NULL,
	"assign_triage_to_on_call" boolean DEFAULT false NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_retention_days_check" CHECK ("workspace_settings"."retention_days" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"ci_key_id" text,
	"ci_key_created_by" text,
	"color" text DEFAULT 'slate' NOT NULL,
	"icon" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"diff_threshold" real DEFAULT 0 NOT NULL,
	"auto_approve_default_branch" boolean DEFAULT true NOT NULL,
	"block_merge_on_changes" boolean DEFAULT true NOT NULL,
	"flaky_blocks_merge" boolean,
	"assign_triage_to_on_call" boolean,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"review_target_hours" integer DEFAULT 24,
	"review_overdue_notify_user_id" text,
	"close_reviews_on_newer_build" boolean DEFAULT true NOT NULL,
	"re_request_on_newer_build" boolean DEFAULT true NOT NULL,
	"auto_approve_no_changes" boolean DEFAULT true NOT NULL,
	"require_reject_reason" boolean DEFAULT false NOT NULL,
	"flaky_after_changes" integer DEFAULT 3 NOT NULL,
	"snooze_default_days" integer DEFAULT 7 NOT NULL,
	"triage_rotation_starts_on" timestamp with time zone,
	"static_hosting_enabled" boolean DEFAULT false NOT NULL,
	"build_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_ci_key_id_unique" UNIQUE("ci_key_id"),
	CONSTRAINT "projects_diff_threshold_check" CHECK ("projects"."diff_threshold" >= 0 and "projects"."diff_threshold" <= 1),
	CONSTRAINT "projects_color_check" CHECK (color in ('slate', 'olive', 'plum', 'moss', 'mauve', 'graphite')),
	CONSTRAINT "projects_retention_days_check" CHECK ("projects"."retention_days" >= 1),
	CONSTRAINT "projects_flaky_after_changes_check" CHECK ("projects"."flaky_after_changes" between 2 and 8),
	CONSTRAINT "projects_snooze_default_days_check" CHECK ("projects"."snooze_default_days" between 1 and 30),
	CONSTRAINT "projects_review_target_hours_check" CHECK ("projects"."review_target_hours" is null or "projects"."review_target_hours" >= 1)
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"requested_by_id" text,
	"reviewer_name" text NOT NULL,
	"requested_by_name" text,
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
CREATE TABLE "review_rule_reviewers" (
	"rule_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rule_reviewers_rule_id_user_id_pk" PRIMARY KEY("rule_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "review_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rules_kind_check" CHECK (kind in ('snapshot-name', 'build-name')),
	CONSTRAINT "review_rules_pattern_check" CHECK (length(btrim("review_rules"."pattern")) > 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"user_id" text,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_state_check" CHECK (state in ('approved', 'rejected')),
	CONSTRAINT "reviews_source_check" CHECK (source in ('ui', 'github-check', 'github-comment', 'gitlab-comment', 'gitlab-status', 'bitbucket-comment', 'bitbucket-status', 'auto', 'rerun'))
);
--> statement-breakpoint
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
CREATE TABLE "ignore_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ignore_regions_size_check" CHECK ("ignore_regions"."width" > 0 and "ignore_regions"."height" > 0 and "ignore_regions"."x" >= 0 and "ignore_regions"."y" >= 0)
);
--> statement-breakpoint
CREATE TABLE "screenshot_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"base_screenshot_id" uuid,
	"head_screenshot_id" uuid,
	"name" text NOT NULL,
	"status" text,
	"score" real,
	"changed_pixels" integer,
	"size_changed" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"ignored_changed_pixels" integer DEFAULT 0 NOT NULL,
	"ignored_regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"diff_file_sha256" text,
	"job_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenshot_diffs_status_check" CHECK (status is null or status in ('added', 'removed', 'changed', 'unchanged', 'failed')),
	CONSTRAINT "screenshot_diffs_job_status_check" CHECK (job_status in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "screenshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"shard_index" text,
	"name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thumbnail_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_code_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_devices" (
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_user_id_fingerprint_pk" PRIMARY KEY("user_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "expired_site_hostnames" (
	"label" text PRIMARY KEY NOT NULL,
	"project_site_id" uuid NOT NULL,
	"expired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"spa" boolean DEFAULT false NOT NULL,
	"custom_domain" text,
	"custom_domain_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sites_kind_check" CHECK (kind in ('storybook', 'vitest-report', 'playwright-report', 'coverage', 'docs', 'generic'))
);
--> statement-breakpoint
CREATE TABLE "site_hostnames" (
	"label" text PRIMARY KEY NOT NULL,
	"project_site_id" uuid NOT NULL,
	"link_kind" text NOT NULL,
	"branch" text,
	"static_site_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_hostnames_kind_check" CHECK (link_kind in ('commit', 'branch'))
);
--> statement-breakpoint
CREATE TABLE "site_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"user_id" text NOT NULL,
	"auth_session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"user_id" text NOT NULL,
	"auth_session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "static_site_files" (
	"static_site_id" uuid NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "static_site_files_static_site_id_path_pk" PRIMARY KEY("static_site_id","path")
);
--> statement-breakpoint
CREATE TABLE "static_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_site_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"entry_path" text DEFAULT 'index.html' NOT NULL,
	"total_bytes" integer NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"assignee_id" text,
	"assignment_source" text,
	"snoozed_until" timestamp with time zone,
	"snooze_kind" text,
	"snoozed_after_build" integer,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_items_kind_check" CHECK (kind in ('flaky', 'no_baseline', 'failed')),
	CONSTRAINT "triage_items_assignment_source_check" CHECK (assignment_source is null or assignment_source in ('auto', 'manual')),
	CONSTRAINT "triage_items_snooze_kind_check" CHECK (snooze_kind is null or snooze_kind in ('next_push', 'tomorrow', 'next_week', 'date'))
);
--> statement-breakpoint
CREATE TABLE "triage_problems" (
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "triage_problems_project_id_kind_key_pk" PRIMARY KEY("project_id","kind","key"),
	CONSTRAINT "triage_problems_kind_check" CHECK (kind in ('flaky', 'no_baseline', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "triage_rotation_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_rotation_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "undo_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "undo_actions_kind_check" CHECK (kind in ('build_review', 'triage_assign', 'triage_snooze', 'triage_dismiss', 'notice_read', 'notice_snooze', 'notice_remove', 'request_snooze', 'request_review'))
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_workspace_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_user_workspace_name_unique" UNIQUE("user_id","workspace_id","name"),
	CONSTRAINT "saved_views_name_check" CHECK (length(btrim("saved_views"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "user_pinned_projects" (
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pinned_projects_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"attempt" integer NOT NULL,
	"status_code" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_events_check" CHECK (cardinality("webhooks"."events") > 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_shards" ADD CONSTRAINT "build_shards_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_base_build_id_builds_id_fk" FOREIGN KEY ("base_build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_ancestry" ADD CONSTRAINT "commit_ancestry_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_thumbnail_sha256_files_sha256_fk" FOREIGN KEY ("thumbnail_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_claims" ADD CONSTRAINT "upload_claims_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_claims" ADD CONSTRAINT "upload_claims_file_sha256_files_sha256_fk" FOREIGN KEY ("file_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_checks" ADD CONSTRAINT "build_checks_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_comments" ADD CONSTRAINT "pr_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_projects" ADD CONSTRAINT "integration_projects_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_projects" ADD CONSTRAINT "integration_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_methods" ADD CONSTRAINT "session_methods_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_auth_settings" ADD CONSTRAINT "workspace_auth_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_deletions" ADD CONSTRAINT "workspace_deletions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_ci_key_id_apikey_id_fk" FOREIGN KEY ("ci_key_id") REFERENCES "public"."apikey"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_ci_key_created_by_user_id_fk" FOREIGN KEY ("ci_key_created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_review_overdue_notify_user_id_user_id_fk" FOREIGN KEY ("review_overdue_notify_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rule_reviewers" ADD CONSTRAINT "review_rule_reviewers_rule_id_review_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."review_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rule_reviewers" ADD CONSTRAINT "review_rule_reviewers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rules" ADD CONSTRAINT "review_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_reviews" ADD CONSTRAINT "snapshot_reviews_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_reviews" ADD CONSTRAINT "snapshot_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ignore_regions" ADD CONSTRAINT "ignore_regions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ignore_regions" ADD CONSTRAINT "ignore_regions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_base_screenshot_id_screenshots_id_fk" FOREIGN KEY ("base_screenshot_id") REFERENCES "public"."screenshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_head_screenshot_id_screenshots_id_fk" FOREIGN KEY ("head_screenshot_id") REFERENCES "public"."screenshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_diff_file_sha256_files_sha256_fk" FOREIGN KEY ("diff_file_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_file_sha256_files_sha256_fk" FOREIGN KEY ("file_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_thumbnail_sha256_files_sha256_fk" FOREIGN KEY ("thumbnail_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expired_site_hostnames" ADD CONSTRAINT "expired_site_hostnames_project_site_id_project_sites_id_fk" FOREIGN KEY ("project_site_id") REFERENCES "public"."project_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_hostnames" ADD CONSTRAINT "site_hostnames_project_site_id_project_sites_id_fk" FOREIGN KEY ("project_site_id") REFERENCES "public"."project_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_hostnames" ADD CONSTRAINT "site_hostnames_static_site_id_static_sites_id_fk" FOREIGN KEY ("static_site_id") REFERENCES "public"."static_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_sessions" ADD CONSTRAINT "site_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_sessions" ADD CONSTRAINT "site_sessions_auth_session_id_session_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tokens" ADD CONSTRAINT "site_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tokens" ADD CONSTRAINT "site_tokens_auth_session_id_session_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_site_files" ADD CONSTRAINT "static_site_files_static_site_id_static_sites_id_fk" FOREIGN KEY ("static_site_id") REFERENCES "public"."static_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_site_files" ADD CONSTRAINT "static_site_files_sha256_files_sha256_fk" FOREIGN KEY ("sha256") REFERENCES "public"."files"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_sites" ADD CONSTRAINT "static_sites_project_site_id_project_sites_id_fk" FOREIGN KEY ("project_site_id") REFERENCES "public"."project_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_problems" ADD CONSTRAINT "triage_problems_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rotation_members" ADD CONSTRAINT "triage_rotation_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rotation_members" ADD CONSTRAINT "triage_rotation_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_actions" ADD CONSTRAINT "undo_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_actions" ADD CONSTRAINT "undo_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_last_workspace_id_workspace_id_fk" FOREIGN KEY ("last_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_projects" ADD CONSTRAINT "user_pinned_projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_projects" ADD CONSTRAINT "user_pinned_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "invitation_workspaceId_idx" ON "invitation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_workspaceId_idx" ON "member" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "builds_project_number_key" ON "builds" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "builds_parallel_key" ON "builds" USING btree ("project_id","name","commit_sha","parallel_nonce") WHERE "builds"."parallel_nonce" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "builds_idempotency_key" ON "builds" USING btree ("project_id","idempotency_key") WHERE "builds"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "builds_project_branch_idx" ON "builds" USING btree ("project_id","branch","created_at");--> statement-breakpoint
CREATE INDEX "builds_project_name_commit_idx" ON "builds" USING btree ("project_id","name","commit_sha");--> statement-breakpoint
CREATE INDEX "builds_base_build_idx" ON "builds" USING btree ("base_build_id");--> statement-breakpoint
CREATE INDEX "builds_author_user_idx" ON "builds" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "comments_build_idx" ON "comments" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "files_gc_marked_idx" ON "files" USING btree ("gc_marked_at") WHERE "files"."gc_marked_at" is not null;--> statement-breakpoint
CREATE INDEX "files_thumbnail_idx" ON "files" USING btree ("thumbnail_sha256");--> statement-breakpoint
CREATE INDEX "upload_claims_file_idx" ON "upload_claims" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "integration_links_build_idx" ON "integration_links" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_links_integration_idx" ON "integration_links" USING btree ("integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_links_project_subject_key" ON "integration_links" USING btree ("project_id","kind","subject") WHERE "integration_links"."build_id" is null and "integration_links"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "integration_projects_project_idx" ON "integration_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","run_at") WHERE "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "jobs" USING btree ("queue","dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_build_idx" ON "notifications" USING btree ("build_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_actor_idx" ON "notifications" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "notifications_project_idx" ON "notifications" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notifications_workspace_idx" ON "notifications" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_domains_workspace_domain_key" ON "workspace_domains" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_domains_verified_domain_key" ON "workspace_domains" USING btree ("domain") WHERE "workspace_domains"."verified_at" is not null;--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_key" ON "projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_open_key" ON "review_requests" USING btree ("build_id","reviewer_id") WHERE "review_requests"."state" = 'open';--> statement-breakpoint
CREATE INDEX "review_requests_reviewer_idx" ON "review_requests" USING btree ("reviewer_id","state");--> statement-breakpoint
CREATE INDEX "review_requests_requester_idx" ON "review_requests" USING btree ("requested_by_id","state");--> statement-breakpoint
CREATE INDEX "review_rule_reviewers_user_idx" ON "review_rule_reviewers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_rules_project_idx" ON "review_rules" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "reviews_build_idx" ON "reviews" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_user_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_reviews_current_key" ON "snapshot_reviews" USING btree ("build_id","snapshot_name") WHERE "snapshot_reviews"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "snapshot_reviews_build_idx" ON "snapshot_reviews" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshot_reviews_user_idx" ON "snapshot_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ignore_regions_project_idx" ON "ignore_regions" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "screenshot_diffs_build_name_key" ON "screenshot_diffs" USING btree ("build_id","name");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_diff_file_idx" ON "screenshot_diffs" USING btree ("diff_file_sha256");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_base_screenshot_idx" ON "screenshot_diffs" USING btree ("base_screenshot_id");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_head_screenshot_idx" ON "screenshot_diffs" USING btree ("head_screenshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screenshots_build_name_key" ON "screenshots" USING btree ("build_id","name");--> statement-breakpoint
CREATE INDEX "screenshots_file_idx" ON "screenshots" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "screenshots_thumbnail_idx" ON "screenshots" USING btree ("thumbnail_sha256");--> statement-breakpoint
CREATE INDEX "email_code_requests_email_idx" ON "email_code_requests" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "expired_site_hostnames_site_idx" ON "expired_site_hostnames" USING btree ("project_site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sites_project_name_key" ON "project_sites" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sites_slug_key" ON "project_sites" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sites_custom_domain_key" ON "project_sites" USING btree ("custom_domain");--> statement-breakpoint
CREATE INDEX "site_hostnames_site_idx" ON "site_hostnames" USING btree ("project_site_id");--> statement-breakpoint
CREATE INDEX "site_hostnames_static_site_idx" ON "site_hostnames" USING btree ("static_site_id");--> statement-breakpoint
CREATE INDEX "site_sessions_expires_idx" ON "site_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "site_sessions_user_idx" ON "site_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_sessions_auth_session_idx" ON "site_sessions" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "site_tokens_user_idx" ON "site_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_tokens_auth_session_idx" ON "site_tokens" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "static_site_files_sha_idx" ON "static_site_files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "static_sites_commit_key" ON "static_sites" USING btree ("project_site_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "triage_items_key" ON "triage_items" USING btree ("project_id","kind","key");--> statement-breakpoint
CREATE INDEX "triage_items_assignee_idx" ON "triage_items" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "triage_rotation_members_user_idx" ON "triage_rotation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "undo_actions_user_idx" ON "undo_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "undo_actions_project_idx" ON "undo_actions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "saved_views_user_workspace_idx" ON "saved_views" USING btree ("user_id","workspace_id","position");--> statement-breakpoint
CREATE INDEX "saved_views_workspace_idx" ON "saved_views" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "saved_views_project_idx" ON "saved_views" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "user_pinned_projects_project_idx" ON "user_pinned_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_hook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhooks_project_idx" ON "webhooks" USING btree ("project_id");