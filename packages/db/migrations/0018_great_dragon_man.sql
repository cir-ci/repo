ALTER TABLE "builds" ADD COLUMN "author_login" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "author_email" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "author_user_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;