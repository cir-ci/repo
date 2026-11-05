CREATE TABLE "org_auth_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"email_login_enabled" boolean DEFAULT true NOT NULL,
	"password_login_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_methods" (
	"session_id" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	CONSTRAINT "session_methods_method_check" CHECK (method in ('password', 'email', 'oidc'))
);
--> statement-breakpoint
ALTER TABLE "org_auth_settings" ADD CONSTRAINT "org_auth_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_methods" ADD CONSTRAINT "session_methods_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;