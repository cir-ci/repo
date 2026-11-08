-- The git hosts (GitHub, GitLab, Bitbucket) become integrations: `provider_connections` rows move to
-- `integrations` (same ids, so nothing that held a connection id changes), and each project's
-- `provider_connection_id` + `repo_ref` become its `integration_projects` row (the repository is the
-- mapping's `external_ref`). Then the old table and columns go.
ALTER TABLE "integrations" ADD COLUMN "needs_attention_at" timestamp with time zone;--> statement-breakpoint
INSERT INTO "integrations" ("id", "org_id", "kind", "display_name", "external_id", "encrypted_credentials", "needs_attention", "needs_attention_reason", "needs_attention_at", "created_at")
SELECT
	pc."id",
	pc."org_id",
	pc."kind",
	CASE WHEN pc."kind" = 'github' THEN 'Installation ' || pc."external_id" ELSE pc."external_id" END,
	pc."external_id",
	pc."encrypted_credentials",
	pc."needs_attention" IS NOT NULL,
	CASE
		WHEN pc."needs_attention" IS NULL THEN NULL
		WHEN pc."kind" = 'github' THEN 'The GitHub App was removed or suspended. Reinstall or unsuspend it on GitHub, then save a repository again.'
		ELSE 'The connection was refused: the token was revoked or lost access. Connect it again.'
	END,
	pc."needs_attention_at",
	pc."created_at"
FROM "provider_connections" AS pc;--> statement-breakpoint
INSERT INTO "integration_projects" ("integration_id", "project_id", "external_ref", "extra")
SELECT p."provider_connection_id", p."id", p."repo_ref", jsonb_build_object('name', p."repo_ref")
FROM "projects" AS p
INNER JOIN "integrations" AS i ON i."id" = p."provider_connection_id"
WHERE p."repo_ref" IS NOT NULL;--> statement-breakpoint
DROP TABLE "provider_connections" CASCADE;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "provider_connection_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "repo_ref";
