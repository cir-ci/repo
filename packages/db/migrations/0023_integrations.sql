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
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text NOT NULL,
	"encrypted_credentials" text,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"needs_attention_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_org_kind_external_key" UNIQUE("org_id","kind","external_id"),
	CONSTRAINT "integrations_kind_check" CHECK (kind in ('slack', 'linear', 'jira', 'figma'))
);
--> statement-breakpoint
ALTER TABLE "provider_connections" RENAME COLUMN "installation_id" TO "external_id";--> statement-breakpoint
DROP INDEX "provider_connections_key";--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "encrypted_credentials" text;--> statement-breakpoint
ALTER TABLE "integration_projects" ADD CONSTRAINT "integration_projects_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_projects" ADD CONSTRAINT "integration_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_key" ON "provider_connections" USING btree ("org_id","kind","external_id");