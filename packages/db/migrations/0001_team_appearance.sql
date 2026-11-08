ALTER TABLE "workspace_settings" ADD COLUMN "retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "ci_key_created_by" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "color" text DEFAULT 'slate' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "ignore_regions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_ci_key_created_by_user_id_fk" FOREIGN KEY ("ci_key_created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ignore_regions" ADD CONSTRAINT "ignore_regions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_retention_days_check" CHECK ("workspace_settings"."retention_days" >= 1);--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_color_check" CHECK (color in ('slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'));