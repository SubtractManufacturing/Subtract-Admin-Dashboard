ALTER TABLE "order_line_items" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD COLUMN "hard_delete_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "hard_delete_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD COLUMN "hard_delete_at" timestamp;--> statement-breakpoint
CREATE INDEX "order_line_items_archive_purge_idx" ON "order_line_items" USING btree ("is_archived","hard_delete_at");--> statement-breakpoint
CREATE INDEX "quote_line_items_archive_purge_idx" ON "quote_line_items" USING btree ("is_archived","hard_delete_at");--> statement-breakpoint
CREATE INDEX "quote_parts_archive_purge_idx" ON "quote_parts" USING btree ("is_archived","hard_delete_at");