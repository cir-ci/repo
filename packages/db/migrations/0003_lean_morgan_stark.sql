CREATE TABLE "workspace_deletions" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "session_methods" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "workspace_auth_settings" ADD COLUMN "signin_github" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_auth_settings" ADD COLUMN "signin_google" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_deletions" ADD CONSTRAINT "workspace_deletions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;