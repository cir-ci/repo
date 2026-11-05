CREATE TABLE "ignore_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ignore_regions_size_check" CHECK ("ignore_regions"."width" > 0 and "ignore_regions"."height" > 0 and "ignore_regions"."x" >= 0 and "ignore_regions"."y" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ignore_regions" ADD CONSTRAINT "ignore_regions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ignore_regions_project_idx" ON "ignore_regions" USING btree ("project_id","name");