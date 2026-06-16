ALTER TABLE "orders" RENAME COLUMN "ship_date" TO "delivery_date";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_date_start" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "lead_time_business_days_min" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "estimated_delivery_date_start" timestamp;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "estimated_delivery_date_end" timestamp;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "lead_time_business_days_min" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "lead_time_business_days_max" integer;
