-- `figma_links` and `issue_links` become rows of `integration_links` (kinds `figma-frame` and `issue`);
-- the data moves first, then the tables go. Ids and timestamps are kept.
INSERT INTO "integration_links" ("id", "integration_id", "project_id", "subject", "kind", "external_ref", "url", "title", "payload", "created_by", "created_at")
SELECT
	fl."id",
	fl."integration_id",
	fl."project_id",
	fl."snapshot_pattern",
	'figma-frame',
	fl."file_key" || ':' || fl."node_id",
	'https://www.figma.com/design/' || fl."file_key" || '?node-id=' || replace(fl."node_id", ':', '-'),
	ip."extra" -> 'frames' ->> fl."node_id",
	jsonb_build_object('fileKey', fl."file_key", 'nodeId', fl."node_id", 'source', fl."source", 'scope', fl."file_key"),
	fl."created_by",
	fl."created_at"
FROM "figma_links" AS fl
LEFT JOIN "integration_projects" AS ip ON ip."integration_id" = fl."integration_id" AND ip."project_id" = fl."project_id";--> statement-breakpoint
INSERT INTO "integration_links" ("id", "integration_id", "build_id", "kind", "external_ref", "url", "title", "payload", "created_by", "created_at")
SELECT
	il."id",
	il."integration_id",
	il."build_id",
	'issue',
	il."issue_key",
	il."url",
	il."title",
	jsonb_build_object('snapshotName', il."snapshot_name"),
	il."created_by",
	il."created_at"
FROM "issue_links" AS il;--> statement-breakpoint
-- Trackers keep the target's name where every integration does (`extra.name`); Figma's file keeps its
-- name there too, and the frame names it remembered are now the links' titles.
UPDATE "integration_projects" AS ip SET "extra" = (ip."extra" - 'targetName') || jsonb_build_object('name', ip."extra" -> 'targetName')
FROM "integrations" AS i
WHERE i."id" = ip."integration_id" AND i."kind" IN ('linear', 'jira') AND ip."extra" ->> 'targetName' IS NOT NULL;--> statement-breakpoint
UPDATE "integration_projects" AS ip SET "extra" = ip."extra" - 'frames' - 'frameCount'
FROM "integrations" AS i
WHERE i."id" = ip."integration_id" AND i."kind" = 'figma';--> statement-breakpoint
DROP TABLE "figma_links" CASCADE;--> statement-breakpoint
DROP TABLE "issue_links" CASCADE;
