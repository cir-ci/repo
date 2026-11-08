CREATE TABLE "review_rule_reviewers" (
	"rule_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rule_reviewers_rule_id_user_id_pk" PRIMARY KEY("rule_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "review_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rules_kind_check" CHECK (kind in ('snapshot-name', 'build-name')),
	CONSTRAINT "review_rules_pattern_check" CHECK (length(btrim("review_rules"."pattern")) > 0)
);
--> statement-breakpoint
CREATE TABLE "triage_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"assignee_id" text,
	"snoozed_until" timestamp with time zone,
	"snooze_kind" text,
	"snoozed_after_build" integer,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_items_kind_check" CHECK (kind in ('flaky', 'no_baseline', 'failed')),
	CONSTRAINT "triage_items_snooze_kind_check" CHECK (snooze_kind is null or snooze_kind in ('next_push', 'tomorrow', 'next_week', 'date'))
);
--> statement-breakpoint
CREATE TABLE "triage_rotation_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_rotation_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "triage_rotation_starts_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_rule_reviewers" ADD CONSTRAINT "review_rule_reviewers_rule_id_review_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."review_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rule_reviewers" ADD CONSTRAINT "review_rule_reviewers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rules" ADD CONSTRAINT "review_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rotation_members" ADD CONSTRAINT "triage_rotation_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rotation_members" ADD CONSTRAINT "triage_rotation_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_rule_reviewers_user_idx" ON "review_rule_reviewers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_rules_project_idx" ON "review_rules" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "triage_items_key" ON "triage_items" USING btree ("project_id","kind","key");--> statement-breakpoint
CREATE INDEX "triage_items_assignee_idx" ON "triage_items" USING btree ("assignee_id");