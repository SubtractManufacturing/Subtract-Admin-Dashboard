CREATE TABLE "email_send_as_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"label" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "email_send_as_addresses_email_unique" UNIQUE("email")
);
