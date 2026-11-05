CREATE TABLE "project_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"spa" boolean DEFAULT false NOT NULL,
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
CREATE UNIQUE INDEX "project_sites_project_name_key" ON "project_sites" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sites_slug_key" ON "project_sites" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "site_hostnames_site_idx" ON "site_hostnames" USING btree ("project_site_id");--> statement-breakpoint
CREATE INDEX "site_sessions_expires_idx" ON "site_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "static_site_files_sha_idx" ON "static_site_files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "static_sites_commit_key" ON "static_sites" USING btree ("project_site_id","commit_sha");