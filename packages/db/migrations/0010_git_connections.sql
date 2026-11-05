CREATE TABLE "build_checks" (
	"build_id" uuid PRIMARY KEY NOT NULL,
	"check_run_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_comments" (
	"project_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"comment_id" text NOT NULL,
	CONSTRAINT "pr_comments_project_id_pr_number_pk" PRIMARY KEY("project_id","pr_number")
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"installation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_connections_kind_check" CHECK (kind in ('github'))
);
--> statement-breakpoint
CREATE TABLE "provider_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "provider_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_ref" text;--> statement-breakpoint
ALTER TABLE "build_checks" ADD CONSTRAINT "build_checks_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_comments" ADD CONSTRAINT "pr_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_key" ON "provider_connections" USING btree ("org_id","kind","installation_id");