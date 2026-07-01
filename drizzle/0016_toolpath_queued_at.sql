ALTER TABLE "quote_parts" ADD COLUMN "toolpath_queued_at" timestamp;--> statement-breakpoint
UPDATE "quote_parts" SET "toolpath_queued_at" = "updated_at" WHERE "toolpath_upload_status" = 'queued' AND "toolpath_queued_at" IS NULL;
