CREATE TYPE "public"."email_category" AS ENUM('general', 'order', 'quote', 'support', 'sales');--> statement-breakpoint
CREATE TABLE "email_thread_assignments" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	CONSTRAINT "email_thread_assignments_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "email_thread_reads" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_thread_reads_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_important" boolean DEFAULT false NOT NULL,
	"category" "email_category" DEFAULT 'general' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"quote_id" integer,
	"order_id" integer,
	"customer_id" integer,
	"vendor_id" integer,
	"email_count" integer DEFAULT 0 NOT NULL,
	"last_email_at" timestamp,
	"latest_snippet" text,
	"participants" text[],
	"latest_from_address" text,
	"latest_from_name" text,
	"latest_direction" "email_direction",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_send_as_addresses" ADD COLUMN "reply_to_address" text;--> statement-breakpoint
ALTER TABLE "email_thread_assignments" ADD CONSTRAINT "email_thread_assignments_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread_assignments" ADD CONSTRAINT "email_thread_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread_assignments" ADD CONSTRAINT "email_thread_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread_reads" ADD CONSTRAINT "email_thread_reads_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread_reads" ADD CONSTRAINT "email_thread_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_thread_assignments_user_idx" ON "email_thread_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_thread_assignments_thread_idx" ON "email_thread_assignments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_thread_reads_user_idx" ON "email_thread_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_thread_reads_thread_idx" ON "email_thread_reads" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_threads_is_read_idx" ON "email_threads" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "email_threads_is_important_idx" ON "email_threads" USING btree ("is_important");--> statement-breakpoint
CREATE INDEX "email_threads_category_idx" ON "email_threads" USING btree ("category");--> statement-breakpoint
CREATE INDEX "email_threads_is_archived_idx" ON "email_threads" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "email_threads_quote_idx" ON "email_threads" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "email_threads_order_idx" ON "email_threads" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "email_threads_customer_idx" ON "email_threads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "email_threads_last_email_at_idx" ON "email_threads" USING btree ("last_email_at");