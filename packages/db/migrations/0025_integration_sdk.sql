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
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_kind_check";--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_links_build_idx" ON "integration_links" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_links_integration_idx" ON "integration_links" USING btree ("integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_links_project_subject_key" ON "integration_links" USING btree ("project_id","kind","subject") WHERE "integration_links"."build_id" is null and "integration_links"."project_id" is not null;--> statement-breakpoint
-- Slack's event toggles were stored as `review_requested`; integrations now use the domain event
-- names (`review.requested`), so the generic mapping page and the event fan-out read one vocabulary.
UPDATE "integration_projects" AS ip SET "extra" = jsonb_set(
	ip."extra",
	'{events}',
	(SELECT coalesce(jsonb_agg(replace(e, '_', '.')), '[]'::jsonb) FROM jsonb_array_elements_text(ip."extra" -> 'events') AS e)
)
FROM "integrations" AS i
WHERE i."id" = ip."integration_id" AND i."kind" = 'slack' AND jsonb_typeof(ip."extra" -> 'events') = 'array';--> statement-breakpoint
-- The `send-slack` queue is replaced by `integration-event`; its payload shape differs.
DELETE FROM "jobs" WHERE "queue" = 'send-slack';
