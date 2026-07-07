CREATE TABLE "order_tracking_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"tracking_number" text NOT NULL,
	"carrier" text,
	"carrier_details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_tracking_numbers" ADD CONSTRAINT "order_tracking_numbers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_tracking_numbers_order_idx" ON "order_tracking_numbers" USING btree ("order_id");