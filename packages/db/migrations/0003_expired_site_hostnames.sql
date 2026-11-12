CREATE TABLE "expired_site_hostnames" (
	"label" text PRIMARY KEY NOT NULL,
	"project_site_id" uuid NOT NULL,
	"expired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expired_site_hostnames" ADD CONSTRAINT "expired_site_hostnames_project_site_id_project_sites_id_fk" FOREIGN KEY ("project_site_id") REFERENCES "public"."project_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expired_site_hostnames_site_idx" ON "expired_site_hostnames" USING btree ("project_site_id");