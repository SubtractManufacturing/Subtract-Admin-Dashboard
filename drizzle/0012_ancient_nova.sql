ALTER TABLE "quote_parts" ADD COLUMN "toolpath_part_id" text;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "toolpath_report_url" text;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "toolpath_cut_config_id" text;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "toolpath_uploaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "toolpath_upload_error" text;