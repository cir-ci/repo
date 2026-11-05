CREATE TABLE "org_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"auto_join_role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_domains_auto_join_role_check" CHECK (auto_join_role in ('member'))
);
--> statement-breakpoint
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_domains_org_domain_key" ON "org_domains" USING btree ("org_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "org_domains_verified_domain_key" ON "org_domains" USING btree ("domain") WHERE "org_domains"."verified_at" is not null;