ALTER TABLE "quote_line_items" DROP CONSTRAINT "quote_line_items_quote_part_id_quote_parts_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE set null ON UPDATE no action;