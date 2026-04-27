CREATE TYPE "public"."attachment_document_kind" AS ENUM('quote', 'invoice', 'purchase_order', 'packing_slip');--> statement-breakpoint
CREATE TYPE "public"."attachment_source" AS ENUM('user_upload', 'generated', 'system');--> statement-breakpoint
CREATE TYPE "public"."email_setting_kind" AS ENUM('operational', 'merge');--> statement-breakpoint
CREATE TYPE "public"."sent_email_entity_type" AS ENUM('quote', 'order', 'invoice');--> statement-breakpoint
CREATE TYPE "public"."sent_email_source" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."sent_email_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'bounced', 'pending_approval', 'rejected');--> statement-breakpoint
CREATE TABLE "email_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_email" text NOT NULL,
	"from_display_name" text,
	"reply_to_email" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"kind" "email_setting_kind" DEFAULT 'operational' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "email_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"layout_slug" text DEFAULT 'styled-quote' NOT NULL,
	"context_key" text,
	"email_identity_id" integer NOT NULL,
	"subject_template" text NOT NULL,
	"body_copy" jsonb NOT NULL,
	"required_attachment_document_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "email_templates_slug_unique" UNIQUE("slug"),
	CONSTRAINT "email_templates_context_key_unique" UNIQUE("context_key")
);
--> statement-breakpoint
CREATE TABLE "sent_email_attachments" (
	"sent_email_id" integer NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "sent_email_attachments_sent_email_id_attachment_id_pk" PRIMARY KEY("sent_email_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "sent_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer,
	"context_key" text NOT NULL,
	"entity_type" "sent_email_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"from_email" text NOT NULL,
	"from_display_name" text,
	"subject" text NOT NULL,
	"to_addresses" text[] NOT NULL,
	"cc_addresses" text[],
	"reply_to" text,
	"recipient_override" text,
	"html_body" text NOT NULL,
	"text_body" text,
	"status" "sent_email_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"sent_at" timestamp,
	"source" "sent_email_source" NOT NULL,
	"sent_by_user_id" text,
	"sent_by_user_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"rejected_by_user_id" text,
	"rejected_at" timestamp,
	CONSTRAINT "sent_emails_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source" "attachment_source";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "document_kind" "attachment_document_kind";--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_email_identity_id_email_identities_id_fk" FOREIGN KEY ("email_identity_id") REFERENCES "public"."email_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_email_attachments" ADD CONSTRAINT "sent_email_attachments_sent_email_id_sent_emails_id_fk" FOREIGN KEY ("sent_email_id") REFERENCES "public"."sent_emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_email_attachments" ADD CONSTRAINT "sent_email_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sent_email_attachments_email_idx" ON "sent_email_attachments" USING btree ("sent_email_id");--> statement-breakpoint
CREATE INDEX "sent_emails_quote_idx" ON "sent_emails" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "sent_emails_status_idx" ON "sent_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sent_emails_entity_idx" ON "sent_emails" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sent_emails_context_idx" ON "sent_emails" USING btree ("context_key");