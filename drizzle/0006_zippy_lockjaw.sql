ALTER TABLE "quote_line_items" DROP CONSTRAINT "quote_line_items_quote_part_id_quote_parts_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_part_drawings" DROP CONSTRAINT "quote_part_drawings_quote_part_id_quote_parts_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_price_calculations" DROP CONSTRAINT "quote_price_calculations_quote_part_id_quote_parts_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_part_drawings" ADD CONSTRAINT "quote_part_drawings_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_price_calculations" ADD CONSTRAINT "quote_price_calculations_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE cascade ON UPDATE no action;