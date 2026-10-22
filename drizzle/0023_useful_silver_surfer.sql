ALTER TABLE "email_templates" ADD COLUMN "to_template" text DEFAULT '{{customerEmail}}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "creation_metadata" jsonb;