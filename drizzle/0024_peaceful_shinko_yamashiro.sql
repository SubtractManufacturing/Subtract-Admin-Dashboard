CREATE TABLE "twenty_sync_links" (
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"twenty_person_id" text,
	"twenty_company_id" text,
	"twenty_opportunity_id" text,
	"synced_source_updated_at" timestamp,
	"synced_company_key" text,
	"synced_quote_status" text,
	"synced_amount_micros" bigint,
	"sync_state" text,
	"last_error" text,
	"failure_detail" jsonb,
	"sync_warning" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "twenty_sync_links_entity_type_entity_id_pk" PRIMARY KEY("entity_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DEFAULT (now() at time zone 'utc');--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "updated_at" SET DEFAULT (now() at time zone 'utc');--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "created_at" SET DEFAULT (now() at time zone 'utc');--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "updated_at" SET DEFAULT (now() at time zone 'utc');--> statement-breakpoint
ALTER TABLE "sent_emails" ALTER COLUMN "created_at" SET DEFAULT (now() at time zone 'utc');--> statement-breakpoint
ALTER TABLE "sent_emails" ALTER COLUMN "updated_at" SET DEFAULT (now() at time zone 'utc');--> statement-breakpoint
CREATE INDEX "twenty_sync_links_state_idx" ON "twenty_sync_links" USING btree ("sync_state");