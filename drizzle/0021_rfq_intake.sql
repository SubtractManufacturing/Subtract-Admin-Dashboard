ALTER TYPE "public"."attachment_document_kind" ADD VALUE 'rfq_intake_archive';--> statement-breakpoint
CREATE TYPE "public"."rfq_import_status" AS ENUM('pending', 'processing', 'retry_scheduled', 'permanent_failure', 'cleanup_pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."action_item_type" AS ENUM('rfq_import_failure', 'customer_match_review');--> statement-breakpoint
CREATE TYPE "public"."action_item_status" AS ENUM('active', 'resolved');--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "nda_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "source_receipt_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "nda_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "is_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_source_receipt_number_unique" UNIQUE("source_receipt_number");--> statement-breakpoint
CREATE TABLE "rfq_import_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_number" text NOT NULL,
	"session_id" uuid NOT NULL,
	"receipt_key" text NOT NULL,
	"quote_id" integer,
	"status" "rfq_import_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp,
	"last_failure_at" timestamp,
	"next_attempt_at" timestamp,
	"error_classification" text,
	"error_detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_import_ledger_receipt_number_unique" UNIQUE("receipt_number")
);--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "action_item_type" NOT NULL,
	"status" "action_item_status" DEFAULT 'active' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seen_by" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution" text,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "rfq_import_ledger" ADD CONSTRAINT "rfq_import_ledger_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_import_ledger_receipt_key_idx" ON "rfq_import_ledger" USING btree ("receipt_key");--> statement-breakpoint
CREATE INDEX "rfq_import_ledger_due_idx" ON "rfq_import_ledger" USING btree ("next_attempt_at") WHERE "rfq_import_ledger"."status" = 'retry_scheduled';--> statement-breakpoint
CREATE INDEX "rfq_import_ledger_quote_idx" ON "rfq_import_ledger" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "action_items_active_idx" ON "action_items" USING btree ("created_at") WHERE "action_items"."status" = 'active' and "action_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "action_items_entity_idx" ON "action_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_items_active_failure_unique_idx" ON "action_items" USING btree ("type","entity_type","entity_id") WHERE "action_items"."type" = 'rfq_import_failure' and "action_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customers_active_email_idx" ON "customers" USING btree (lower(trim("email"))) WHERE "customers"."is_archived" = false and "customers"."email" is not null;--> statement-breakpoint
ALTER TABLE "rfq_import_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_items" ENABLE ROW LEVEL SECURITY;
