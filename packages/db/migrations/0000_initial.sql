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
	"baseline_source" text,
	"base_build_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"parallel_nonce" text,
	"parallel_total" integer,
	"conclusion" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
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
CREATE TABLE "files" (
	"sha256" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"size" bigint,
	"width" integer,
	"height" integer,
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
CREATE TABLE "memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK (role in ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"token_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"diff_threshold" real DEFAULT 0 NOT NULL,
	"auto_approve_default_branch" boolean DEFAULT true NOT NULL,
	"block_merge_on_changes" boolean DEFAULT true NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"static_hosting_enabled" boolean DEFAULT false NOT NULL,
	"build_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "projects_diff_threshold_check" CHECK ("projects"."diff_threshold" >= 0 and "projects"."diff_threshold" <= 1),
	CONSTRAINT "projects_retention_days_check" CHECK ("projects"."retention_days" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"user_id" uuid,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_state_check" CHECK (state in ('approved', 'rejected')),
	CONSTRAINT "reviews_source_check" CHECK (source in ('ui', 'github-check', 'github-comment', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "screenshot_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"base_screenshot_id" uuid,
	"head_screenshot_id" uuid,
	"status" text,
	"score" real,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_claims" (
	"build_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_claims_build_id_file_sha256_pk" PRIMARY KEY("build_id","file_sha256")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_shards" ADD CONSTRAINT "build_shards_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_base_build_id_builds_id_fk" FOREIGN KEY ("base_build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_ancestry" ADD CONSTRAINT "commit_ancestry_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_base_screenshot_id_screenshots_id_fk" FOREIGN KEY ("base_screenshot_id") REFERENCES "public"."screenshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_head_screenshot_id_screenshots_id_fk" FOREIGN KEY ("head_screenshot_id") REFERENCES "public"."screenshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD CONSTRAINT "screenshot_diffs_diff_file_sha256_files_sha256_fk" FOREIGN KEY ("diff_file_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_file_sha256_files_sha256_fk" FOREIGN KEY ("file_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_claims" ADD CONSTRAINT "upload_claims_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_claims" ADD CONSTRAINT "upload_claims_file_sha256_files_sha256_fk" FOREIGN KEY ("file_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "builds_project_number_key" ON "builds" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "builds_parallel_key" ON "builds" USING btree ("project_id","name","commit_sha","parallel_nonce") WHERE "builds"."parallel_nonce" is not null;--> statement-breakpoint
CREATE INDEX "builds_project_branch_idx" ON "builds" USING btree ("project_id","branch","created_at");--> statement-breakpoint
CREATE INDEX "builds_project_name_commit_idx" ON "builds" USING btree ("project_id","name","commit_sha");--> statement-breakpoint
CREATE INDEX "files_gc_marked_idx" ON "files" USING btree ("gc_marked_at") WHERE "files"."gc_marked_at" is not null;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_key" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "reviews_build_idx" ON "reviews" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_build_idx" ON "screenshot_diffs" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "screenshot_diffs_diff_file_idx" ON "screenshot_diffs" USING btree ("diff_file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "screenshots_build_name_key" ON "screenshots" USING btree ("build_id","name");--> statement-breakpoint
CREATE INDEX "screenshots_file_idx" ON "screenshots" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "upload_claims_file_idx" ON "upload_claims" USING btree ("file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));