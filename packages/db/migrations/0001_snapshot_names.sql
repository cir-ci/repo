ALTER TABLE "comments" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "reviewer_name" text;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "requested_by_name" text;--> statement-breakpoint
UPDATE "comments" SET "author_name" = "user"."name" FROM "user" WHERE "user"."id" = "comments"."author_id";--> statement-breakpoint
UPDATE "review_requests" SET "reviewer_name" = "user"."name" FROM "user" WHERE "user"."id" = "review_requests"."reviewer_id";--> statement-breakpoint
UPDATE "review_requests" SET "requested_by_name" = "user"."name" FROM "user" WHERE "user"."id" = "review_requests"."requested_by_id";--> statement-breakpoint
ALTER TABLE "review_requests" ALTER COLUMN "reviewer_name" SET NOT NULL;
