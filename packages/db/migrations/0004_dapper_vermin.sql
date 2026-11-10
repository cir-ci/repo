CREATE TABLE "undo_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"team_id" uuid,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "undo_actions_kind_check" CHECK (kind in ('build_review', 'triage_assign', 'triage_snooze', 'triage_dismiss', 'notice_read', 'notice_snooze', 'notice_remove', 'request_snooze', 'request_review'))
);
--> statement-breakpoint
ALTER TABLE "undo_actions" ADD CONSTRAINT "undo_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_actions" ADD CONSTRAINT "undo_actions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "undo_actions_user_idx" ON "undo_actions" USING btree ("user_id","created_at");