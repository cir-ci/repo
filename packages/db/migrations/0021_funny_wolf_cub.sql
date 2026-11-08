CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"snapshot_name" text,
	"region_x" double precision,
	"region_y" double precision,
	"region_width" double precision,
	"region_height" double precision,
	"body" text NOT NULL,
	"author_id" text,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comments_region_check" CHECK (("comments"."region_x" is null and "comments"."region_y" is null and "comments"."region_width" is null and "comments"."region_height" is null)
        or ("comments"."snapshot_name" is not null
          and "comments"."region_x" >= 0 and "comments"."region_y" >= 0
          and "comments"."region_width" > 0 and "comments"."region_height" > 0
          and "comments"."region_x" + "comments"."region_width" <= 1 and "comments"."region_y" + "comments"."region_height" <= 1))
);
--> statement-breakpoint
ALTER TABLE "build_checks" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_build_idx" ON "comments" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");