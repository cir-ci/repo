ALTER TABLE "teams" DROP CONSTRAINT "teams_flaky_after_changes_check";--> statement-breakpoint
-- The threshold now counts flip-flops (returns to an earlier image), not changes: one is a normal revert, so the
-- lowest is 2, and a 10-commit window allows at most 8. Existing teams are clamped into that range.
UPDATE "teams" SET "flaky_after_changes" = LEAST(GREATEST("flaky_after_changes", 2), 8);--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "flaky_decision" jsonb;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_flaky_after_changes_check" CHECK ("teams"."flaky_after_changes" between 2 and 8);
