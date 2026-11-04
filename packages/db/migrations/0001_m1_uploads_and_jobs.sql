CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"queue" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status_check" CHECK (status in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
DROP INDEX "screenshot_diffs_build_idx";--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD COLUMN "changed_pixels" integer;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD COLUMN "size_changed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "screenshot_diffs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN "thumbnail_sha256" text;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","run_at") WHERE "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "jobs" USING btree ("queue","dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('pending', 'running');--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_thumbnail_sha256_files_sha256_fk" FOREIGN KEY ("thumbnail_sha256") REFERENCES "public"."files"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenshot_diffs_build_name_key" ON "screenshot_diffs" USING btree ("build_id","name");--> statement-breakpoint
CREATE INDEX "screenshots_thumbnail_idx" ON "screenshots" USING btree ("thumbnail_sha256");