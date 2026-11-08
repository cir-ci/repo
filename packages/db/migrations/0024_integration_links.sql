CREATE TABLE "figma_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"snapshot_pattern" text NOT NULL,
	"file_key" text NOT NULL,
	"node_id" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "figma_links_project_pattern_key" UNIQUE("project_id","snapshot_pattern"),
	CONSTRAINT "figma_links_source_check" CHECK (source in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"snapshot_name" text,
	"integration_id" uuid NOT NULL,
	"issue_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_connections" DROP CONSTRAINT "provider_connections_kind_check";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_source_check";--> statement-breakpoint
ALTER TABLE "figma_links" ADD CONSTRAINT "figma_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "figma_links" ADD CONSTRAINT "figma_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "figma_links" ADD CONSTRAINT "figma_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "figma_links_integration_idx" ON "figma_links" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "issue_links_build_idx" ON "issue_links" USING btree ("build_id","created_at");--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_kind_check" CHECK (kind in ('github', 'gitlab', 'bitbucket'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_source_check" CHECK (source in ('ui', 'github-check', 'github-comment', 'gitlab-comment', 'gitlab-status', 'bitbucket-comment', 'bitbucket-status', 'auto', 'rerun'));