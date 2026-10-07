CREATE TABLE "customer_email_aliases" (
	"customer_id" integer NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_email_aliases_customer_id_email_pk" PRIMARY KEY("customer_id","email")
);
--> statement-breakpoint
CREATE TABLE "customer_merge_dismissals" (
	"low_customer_id" integer NOT NULL,
	"high_customer_id" integer NOT NULL,
	"dismissed_by" text,
	"dismissed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_merge_dismissals_low_customer_id_high_customer_id_pk" PRIMARY KEY("low_customer_id","high_customer_id"),
	CONSTRAINT "customer_merge_dismissals_ordered_pair" CHECK ("customer_merge_dismissals"."low_customer_id" < "customer_merge_dismissals"."high_customer_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "merged_into_customer_id" integer;--> statement-breakpoint
ALTER TABLE "customer_email_aliases" ADD CONSTRAINT "customer_email_aliases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merge_dismissals" ADD CONSTRAINT "customer_merge_dismissals_low_customer_id_customers_id_fk" FOREIGN KEY ("low_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merge_dismissals" ADD CONSTRAINT "customer_merge_dismissals_high_customer_id_customers_id_fk" FOREIGN KEY ("high_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merge_dismissals" ADD CONSTRAINT "customer_merge_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_email_aliases_email_idx" ON "customer_email_aliases" USING btree ("email");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_customer_id_customers_id_fk" FOREIGN KEY ("merged_into_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- One-time backfill of primary emails into customer_email_aliases.
-- Mirrors normalizeEmail (app/lib/email-normalize.ts): strip invisible
-- characters, NFKC, trim, unwrap one angle-bracket pair, strip a leading
-- mailto:, trim, strip trailing punctuation, lowercase, and keep a single
-- address. Plus-tags and dots are preserved.
INSERT INTO "customer_email_aliases" ("customer_id", "email")
SELECT id, normalized
FROM (
  SELECT
    customers.id,
    CASE
      WHEN prepared ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN lower(prepared)
      ELSE NULL
    END AS normalized
  FROM "customers"
  CROSS JOIN LATERAL (
    SELECT
      regexp_replace(
        btrim(
          regexp_replace(
            CASE
              WHEN folded ~ '<[^<>]*>' THEN btrim((regexp_match(folded, '<([^<>]*)>'))[1])
              ELSE folded
            END,
            '^mailto:',
            '',
            'i'
          )
        ),
        '[.,;:!?]+$',
        ''
      ) AS prepared
    FROM (
      SELECT
        btrim(
          normalize(
            regexp_replace(
              "customers"."email",
              '['
                || chr(8203) || chr(8204) || chr(8205)
                || chr(8288)
                || chr(65279)
                || chr(173)
                || chr(160)
                || chr(8239)
                || chr(8199)
                || ']',
              '',
              'g'
            ),
            NFKC
          )
        ) AS folded
    ) folded_email
  ) prepared_email
  WHERE "customers"."email" IS NOT NULL
) normalized_emails
WHERE normalized IS NOT NULL
ON CONFLICT ("customer_id", "email") DO NOTHING;