CREATE TYPE "public"."email_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('sent', 'delivered', 'bounced', 'spam_complaint', 'failed');--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"content_length" integer,
	"s3_bucket" text,
	"s3_key" text,
	"content_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"postmark_message_id" text,
	"postmark_message_stream_id" text,
	"thread_id" text NOT NULL,
	"direction" "email_direction" NOT NULL,
	"status" "email_status" DEFAULT 'sent' NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" text[] NOT NULL,
	"cc_addresses" text[],
	"bcc_addresses" text[],
	"reply_to" text,
	"subject" text NOT NULL,
	"text_body" text,
	"html_body" text,
	"message_id" text,
	"in_reply_to" text,
	"references" text,
	"quote_id" integer,
	"order_id" integer,
	"customer_id" integer,
	"vendor_id" integer,
	"metadata" jsonb,
	"gmail_mirrored" boolean DEFAULT false,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"bounced_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"state_source" text DEFAULT 'webhook',
	"reconciliation_notes" text,
	CONSTRAINT "emails_postmark_message_id_unique" UNIQUE("postmark_message_id")
);
--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_attachments_email_idx" ON "email_attachments" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "emails_quote_idx" ON "emails" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "emails_order_idx" ON "emails" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "emails_customer_idx" ON "emails" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "emails_message_id_idx" ON "emails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "emails_postmark_idx" ON "emails" USING btree ("postmark_message_id");--> statement-breakpoint
CREATE INDEX "emails_thread_idx" ON "emails" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "emails_in_reply_to_idx" ON "emails" USING btree ("in_reply_to");--> statement-breakpoint
CREATE INDEX "emails_direction_status_idx" ON "emails" USING btree ("direction","status");--> statement-breakpoint
CREATE INDEX "emails_sent_at_idx" ON "emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "emails_last_reconciled_idx" ON "emails" USING btree ("last_reconciled_at");