CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;