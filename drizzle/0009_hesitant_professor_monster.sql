ALTER TABLE "quotes" ADD COLUMN "stripe_payment_link_url" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "stripe_payment_link_id" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "stripe_payment_link_active" boolean;