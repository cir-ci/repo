CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_workspace_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_last_workspace_id_workspace_id_fk" FOREIGN KEY ("last_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;