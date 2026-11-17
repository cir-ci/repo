CREATE TABLE "site_artifact_imports" (
	"project_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"run_attempt" integer NOT NULL,
	"status" text NOT NULL,
	"artifact_id" text,
	"commit_sha" text NOT NULL,
	"message" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_artifact_imports_project_id_run_id_run_attempt_pk" PRIMARY KEY("project_id","run_id","run_attempt"),
	CONSTRAINT "site_artifact_imports_status_check" CHECK (status in ('published', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sites_from_actions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sites_artifact_name" text DEFAULT 'circi-site' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sites_artifact_site_name" text;--> statement-breakpoint
ALTER TABLE "site_artifact_imports" ADD CONSTRAINT "site_artifact_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_artifact_imports_project_idx" ON "site_artifact_imports" USING btree ("project_id","updated_at");