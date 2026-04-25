ALTER TABLE "email_templates" ADD COLUMN "required_attachment_document_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Renames app email context key from order_customer_confirmation to order_confirmation (see email-context-registry).
UPDATE "email_templates" SET "context_key" = 'order_confirmation', "updated_at" = now() WHERE "context_key" = 'order_customer_confirmation';--> statement-breakpoint
UPDATE "sent_emails" SET "context_key" = 'order_confirmation', "updated_at" = now() WHERE "context_key" = 'order_customer_confirmation';