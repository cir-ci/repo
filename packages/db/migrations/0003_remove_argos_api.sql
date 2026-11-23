ALTER TABLE "commit_ancestry" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "commit_ancestry" CASCADE;--> statement-breakpoint
ALTER TABLE "builds" DROP CONSTRAINT "builds_baseline_source_check";--> statement-breakpoint
UPDATE "builds" SET "baseline_source" = 'none' WHERE "baseline_source" = 'sdk';--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_baseline_source_check" CHECK (baseline_source is null or baseline_source in ('cli', 'provider', 'fallback', 'none'));