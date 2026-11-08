ALTER TABLE "provider_connections" ADD COLUMN "needs_attention" text;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "needs_attention_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_needs_attention_check" CHECK (needs_attention is null or needs_attention in ('installation_revoked'));