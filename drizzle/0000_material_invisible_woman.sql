CREATE TYPE "public"."event_category" AS ENUM('status', 'document', 'financial', 'communication', 'system', 'quality', 'manufacturing');--> statement-breakpoint
CREATE TYPE "public"."lead_time" AS ENUM('Standard', 'Expedited', 'Custom');--> statement-breakpoint
CREATE TYPE "public"."mesh_conversion_status" AS ENUM('pending', 'queued', 'in_progress', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('Pending', 'Waiting_For_Shop_Selection', 'In_Production', 'In_Inspection', 'Shipped', 'Delivered', 'Completed', 'Cancelled', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('RFQ', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Dropped', 'Expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('User', 'Admin', 'Dev');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"s3_bucket" text NOT NULL,
	"s3_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_attachments" (
	"customer_id" integer NOT NULL,
	"attachment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_attachments_customer_id_attachment_id_pk" PRIMARY KEY("customer_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"company_name" text,
	"contact_name" text,
	"title" text,
	"email" text,
	"phone" text,
	"is_primary_contact" boolean DEFAULT false,
	"billing_address_line1" text,
	"billing_address_line2" text,
	"billing_city" text,
	"billing_state" text,
	"billing_postal_code" text,
	"billing_country" text DEFAULT 'US',
	"shipping_address_line1" text,
	"shipping_address_line2" text,
	"shipping_city" text,
	"shipping_state" text,
	"shipping_postal_code" text,
	"shipping_country" text DEFAULT 'US',
	"payment_terms" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_category" "event_category" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"user_id" text,
	"user_email" text,
	"ip_address" text,
	"user_agent" text,
	"is_dismissed" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp,
	"dismissed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "login_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"ip_address" text NOT NULL,
	"user_agent" text,
	"success" boolean NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_attachments" (
	"order_id" integer NOT NULL,
	"attachment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_attachments_order_id_attachment_id_pk" PRIMARY KEY("order_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"part_id" uuid,
	"name" text,
	"description" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" integer,
	"vendor_id" integer,
	"quote_id" integer,
	"source_quote_id" integer,
	"status" "order_status" DEFAULT 'Pending' NOT NULL,
	"total_price" numeric(10, 2),
	"vendor_pay" numeric(10, 2),
	"ship_date" timestamp,
	"notes" text,
	"lead_time" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_drawings" (
	"part_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "part_drawings_part_id_attachment_id_pk" PRIMARY KEY("part_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "part_models" (
	"part_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "part_models_part_id_attachment_id_pk" PRIMARY KEY("part_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" integer,
	"part_name" text,
	"notes" text,
	"material" text,
	"tolerance" text,
	"finishing" text,
	"thumbnail_url" text,
	"part_file_url" text,
	"part_mesh_url" text,
	"mesh_conversion_status" text DEFAULT 'pending',
	"mesh_conversion_error" text,
	"mesh_conversion_job_id" text,
	"mesh_conversion_started_at" timestamp,
	"mesh_conversion_completed_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_attachments" (
	"quote_id" integer NOT NULL,
	"attachment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quote_attachments_quote_id_attachment_id_pk" PRIMARY KEY("quote_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"quote_part_id" uuid,
	"name" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"lead_time_days" integer,
	"description" text,
	"notes" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_part_drawings" (
	"quote_part_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quote_part_drawings_quote_part_id_attachment_id_pk" PRIMARY KEY("quote_part_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "quote_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" integer NOT NULL,
	"part_number" text NOT NULL,
	"part_name" text NOT NULL,
	"description" text,
	"material" text,
	"finish" text,
	"tolerance" text,
	"thumbnail_url" text,
	"part_file_url" text,
	"part_mesh_url" text,
	"conversion_status" "mesh_conversion_status" DEFAULT 'pending',
	"mesh_conversion_error" text,
	"mesh_conversion_job_id" text,
	"mesh_conversion_started_at" timestamp,
	"mesh_conversion_completed_at" timestamp,
	"specifications" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_price_calculation_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lead_time_option" text,
	"small_thread_count" integer,
	"medium_thread_count" integer,
	"large_thread_count" integer,
	"complexity_multiplier" numeric(4, 2),
	"tolerance_multiplier" numeric(4, 2),
	"is_global" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_price_calculations" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"quote_line_item_id" integer,
	"quote_part_id" uuid,
	"toolpath_grand_total" numeric(10, 2) NOT NULL,
	"lead_time_option" text NOT NULL,
	"lead_time_multiplier" numeric(4, 2) NOT NULL,
	"small_thread_count" integer DEFAULT 0 NOT NULL,
	"small_thread_rate" numeric(6, 2) DEFAULT '0.90' NOT NULL,
	"medium_thread_count" integer DEFAULT 0 NOT NULL,
	"medium_thread_rate" numeric(6, 2) DEFAULT '0.75' NOT NULL,
	"large_thread_count" integer DEFAULT 0 NOT NULL,
	"large_thread_rate" numeric(6, 2) DEFAULT '1.10' NOT NULL,
	"total_thread_cost" numeric(10, 2) NOT NULL,
	"complexity_multiplier" numeric(4, 2) NOT NULL,
	"tolerance_multiplier" numeric(4, 2) NOT NULL,
	"tooling_cost" numeric(10, 2),
	"tooling_markup" numeric(10, 2),
	"base_price" numeric(10, 2) NOT NULL,
	"adjusted_price" numeric(10, 2) NOT NULL,
	"final_price" numeric(10, 2) NOT NULL,
	"notes" text,
	"calculated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"vendor_id" integer,
	"status" "quote_status" DEFAULT 'RFQ' NOT NULL,
	"valid_until" timestamp,
	"expiration_days" integer,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"expired_at" timestamp,
	"archived_at" timestamp,
	"subtotal" numeric(10, 2),
	"total" numeric(10, 2),
	"created_by_id" text,
	"converted_to_order_id" integer,
	"rejection_reason" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quote_number_unique" UNIQUE("quote_number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'User' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_attachments" (
	"vendor_id" integer NOT NULL,
	"attachment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_attachments_vendor_id_attachment_id_pk" PRIMARY KEY("vendor_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"company_name" text,
	"contact_name" text,
	"title" text,
	"email" text,
	"phone" text,
	"is_primary_contact" boolean DEFAULT false,
	"billing_address_line1" text,
	"billing_address_line2" text,
	"billing_city" text,
	"billing_state" text,
	"billing_postal_code" text,
	"billing_country" text DEFAULT 'US',
	"shipping_address_line1" text,
	"shipping_address_line2" text,
	"shipping_city" text,
	"shipping_state" text,
	"shipping_postal_code" text,
	"shipping_country" text DEFAULT 'US',
	"payment_terms" text,
	"address" text,
	"notes" text,
	"discord_id" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_attachments" ADD CONSTRAINT "customer_attachments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_attachments" ADD CONSTRAINT "customer_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attachments" ADD CONSTRAINT "order_attachments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attachments" ADD CONSTRAINT "order_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_drawings" ADD CONSTRAINT "part_drawings_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_drawings" ADD CONSTRAINT "part_drawings_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_models" ADD CONSTRAINT "part_models_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_models" ADD CONSTRAINT "part_models_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_part_drawings" ADD CONSTRAINT "quote_part_drawings_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_part_drawings" ADD CONSTRAINT "quote_part_drawings_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_parts" ADD CONSTRAINT "quote_parts_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_price_calculation_templates" ADD CONSTRAINT "quote_price_calculation_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_price_calculations" ADD CONSTRAINT "quote_price_calculations_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_price_calculations" ADD CONSTRAINT "quote_price_calculations_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_price_calculations" ADD CONSTRAINT "quote_price_calculations_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_price_calculations" ADD CONSTRAINT "quote_calc_line_item_fk" FOREIGN KEY ("quote_line_item_id") REFERENCES "public"."quote_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_to_order_id_orders_id_fk" FOREIGN KEY ("converted_to_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_attachments" ADD CONSTRAINT "vendor_attachments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_attachments" ADD CONSTRAINT "vendor_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_company_name_idx" ON "customers" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "event_logs_entity_idx" ON "event_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "event_logs_timestamp_idx" ON "event_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "event_logs_category_idx" ON "event_logs" USING btree ("event_category");--> statement-breakpoint
CREATE INDEX "vendors_company_name_idx" ON "vendors" USING btree ("company_name");