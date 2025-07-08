CREATE TYPE "quote_status" AS ENUM (
  'Draft',
  'Sent',
  'Accepted',
  'Rejected',
  'Expired'
);

CREATE TYPE "order_status" AS ENUM (
  'Pending',
  'In_Production',
  'Completed',
  'Cancelled'
);

CREATE TYPE "lead_time" AS ENUM (
  'Standard',
  'Expedited',
  'Custom'
);

CREATE TYPE "currency" AS ENUM (
  'USD',
  'EUR',
  'GBP',
  'CNY'
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar,
  "email" varchar UNIQUE NOT NULL,
  "password_hash" varchar NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "customers" (
  "id" serial PRIMARY KEY,
  "display_name" varchar NOT NULL,
  "email" varchar,
  "phone" varchar(20),
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "vendors" (
  "id" serial PRIMARY KEY,
  "display_name" varchar NOT NULL,
  "company_name" varchar,
  "contact_name" varchar,
  "email" varchar UNIQUE,
  "phone" varchar(20),
  "address" varchar,
  "notes" text,
  "attachments" uuid,
  "discord_id" varchar,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "parts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "part_name" text,
  "notes" text,
  "material" varchar,
  "tolerance" varchar,
  "finishing" varchar,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "s3_bucket" text NOT NULL,
  "s3_key" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "file_size" int,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "part_drawings" (
  "part_id" uuid NOT NULL,
  "attachment_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  PRIMARY KEY ("part_id", "attachment_id")
);

CREATE TABLE "part_models" (
  "part_id" uuid NOT NULL,
  "attachment_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  PRIMARY KEY ("part_id", "attachment_id")
);

CREATE TABLE "quotes" (
  "id" serial PRIMARY KEY,
  "customer_id" serial NOT NULL,
  "vendor_id" serial NOT NULL,
  "status" quote_status NOT NULL DEFAULT 'Draft',
  "lead_time" lead_time,
  "currency" currency NOT NULL DEFAULT 'USD',
  "total_price" numeric,
  "valid_until" date,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "quote_line_items" (
  "quote_id" serial NOT NULL,
  "part_id" uuid NOT NULL,
  "name" varchar,
  "description" text,
  "quantity" integer NOT NULL,
  "unit_price" numeric NOT NULL,
  "notes" text,
  PRIMARY KEY ("quote_id", "part_id")
);

CREATE TABLE "order_line_items" (
  "order_id" serial NOT NULL,
  "part_id" uuid NOT NULL,
  "name" varchar,
  "description" text,
  "quantity" integer NOT NULL,
  "unit_price" numeric NOT NULL,
  "notes" text,
  PRIMARY KEY ("order_id", "part_id")
);

CREATE TABLE "orders" (
  "id" serial PRIMARY KEY,
  "customer_id" serial,
  "vendor_id" serial,
  "quote_id" serial,
  "status" order_status NOT NULL DEFAULT 'Pending',
  "total_price" numeric,
  "vendor_pay" numeric,
  "ship_date" date,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "event_log" (
  "id" serial PRIMARY KEY,
  "object_id" varchar,
  "event_type" varchar NOT NULL,
  "field_name" varchar,
  "old_value" text,
  "new_value" text,
  "changed_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

ALTER TABLE "vendors" ADD FOREIGN KEY ("attachments") REFERENCES "attachments" ("id");

ALTER TABLE "part_drawings" ADD FOREIGN KEY ("part_id") REFERENCES "parts" ("id");

ALTER TABLE "part_drawings" ADD FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id");

ALTER TABLE "part_models" ADD FOREIGN KEY ("part_id") REFERENCES "parts" ("id");

ALTER TABLE "part_models" ADD FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id");

ALTER TABLE "quotes" ADD FOREIGN KEY ("customer_id") REFERENCES "customers" ("id");

ALTER TABLE "quotes" ADD FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id");

ALTER TABLE "quote_line_items" ADD FOREIGN KEY ("quote_id") REFERENCES "quotes" ("id");

ALTER TABLE "quote_line_items" ADD FOREIGN KEY ("part_id") REFERENCES "parts" ("id");

ALTER TABLE "order_line_items" ADD FOREIGN KEY ("order_id") REFERENCES "orders" ("id");

ALTER TABLE "order_line_items" ADD FOREIGN KEY ("part_id") REFERENCES "parts" ("id");

ALTER TABLE "orders" ADD FOREIGN KEY ("customer_id") REFERENCES "customers" ("id");

ALTER TABLE "orders" ADD FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id");

ALTER TABLE "orders" ADD FOREIGN KEY ("quote_id") REFERENCES "quotes" ("id");

ALTER TABLE "event_log" ADD FOREIGN KEY ("changed_by") REFERENCES "users" ("id");
