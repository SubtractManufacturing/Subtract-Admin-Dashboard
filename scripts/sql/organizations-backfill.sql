-- ADR-0013 deployment 1: backfill Organizations, Contacts, Accounts and
-- addresses from the legacy `customers` and `vendors` tables.
--
-- One row in, one row out: every legacy Customer or Vendor becomes exactly one
-- Organization, one Contact (linked as primary), one Account, and its billing
-- and default shipping addresses. Nothing is grouped by company or domain.
--
-- Idempotent and keyed on legacy ids, so running it twice changes nothing:
--   * a legacy row is copied only when no Organization carries its legacy id;
--   * its aliases, attachments and communications are copied in the same step;
--   * foreign keys are filled only where still null;
--   * polymorphic rows are rewritten only while they still hold an integer id.
--
-- Production: append this file, unchanged, to the feature migration after the
-- generated DDL. Dev and test databases (db:push): `npm run backfill:organizations`.
-- The legacy tables are read, never written.

CREATE OR REPLACE FUNCTION pg_temp.crm_normalize_email(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  -- Mirrors normalizeEmail (app/lib/email-normalize.ts) and migration 0022.
  SELECT CASE WHEN prepared ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN lower(prepared) END
  FROM (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(
          CASE
            WHEN folded ~ '<[^<>]*>' THEN regexp_replace((regexp_match(folded, '<([^<>]*)>'))[1], '^[[:space:]]+|[[:space:]]+$', '', 'g')
            ELSE folded
          END,
          '^mailto:', '', 'i'),
        '^[[:space:]]+|[[:space:]]+$', '', 'g'),
      '[.,;:!?]+$', '') AS prepared
    FROM (
      SELECT regexp_replace(
        normalize(
          regexp_replace(
            raw,
            '[' || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279)
                || chr(173) || chr(160) || chr(8239) || chr(8199) || ']',
            '', 'g'),
          NFKC),
        '^[[:space:]]+|[[:space:]]+$', '', 'g') AS folded
    ) folded_email
  ) prepared_email
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.crm_backfill_party(
  legacy_type text,
  legacy_id integer,
  display_name text,
  company_name text,
  contact_name text,
  title text,
  email text,
  phone text,
  billing text[],
  shipping text[],
  payment_terms text,
  discord_id text,
  legacy_address text,
  legacy_notes text,
  is_archived boolean,
  created_at timestamp,
  updated_at timestamp
) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE
  company text := nullif(btrim(company_name), '');
  person text := nullif(btrim(contact_name), '');
  shown text := nullif(btrim(display_name), '');
  org_id uuid;
  contact_id uuid;
  billing_id uuid;
  normalized text;
BEGIN
  -- billing/shipping: line1, line2, city, state, postal code, country.
  INSERT INTO organizations (kind, name, legacy_customer_id, legacy_vendor_id, is_archived, created_at, updated_at)
  VALUES (
    CASE WHEN company IS NOT NULL THEN 'business' ELSE 'individual' END::organization_kind,
    coalesce(company, shown, display_name),
    CASE WHEN legacy_type = 'customer' THEN legacy_id END,
    CASE WHEN legacy_type = 'vendor' THEN legacy_id END,
    is_archived, created_at, updated_at)
  RETURNING id INTO org_id;

  INSERT INTO contacts (name, title, email, phone, is_archived, created_at, updated_at)
  VALUES (
    coalesce(person, CASE WHEN company IS NULL OR shown IS DISTINCT FROM company THEN shown END),
    nullif(btrim(title), ''),
    nullif(btrim(email), ''),
    nullif(btrim(phone), ''),
    is_archived, created_at, updated_at)
  RETURNING id INTO contact_id;

  INSERT INTO organization_contacts (organization_id, contact_id, is_primary, created_at, updated_at)
  VALUES (org_id, contact_id, true, created_at, updated_at);

  normalized := pg_temp.crm_normalize_email(email);
  IF normalized IS NOT NULL THEN
    INSERT INTO contact_email_aliases (contact_id, email, created_at)
    VALUES (contact_id, normalized, created_at)
    ON CONFLICT DO NOTHING;
  END IF;

  IF coalesce(nullif(btrim(billing[1]), ''), nullif(btrim(billing[2]), ''), nullif(btrim(billing[3]), ''),
              nullif(btrim(billing[4]), ''), nullif(btrim(billing[5]), '')) IS NOT NULL THEN
    INSERT INTO addresses (organization_id, label, line1, line2, city, state, postal_code, country,
                           is_default_shipping, created_at, updated_at)
    VALUES (org_id, 'Billing', billing[1], billing[2], billing[3], billing[4], billing[5], billing[6],
            false, created_at, updated_at)
    RETURNING id INTO billing_id;
  END IF;

  IF coalesce(nullif(btrim(shipping[1]), ''), nullif(btrim(shipping[2]), ''), nullif(btrim(shipping[3]), ''),
              nullif(btrim(shipping[4]), ''), nullif(btrim(shipping[5]), '')) IS NOT NULL THEN
    INSERT INTO addresses (organization_id, label, line1, line2, city, state, postal_code, country,
                           is_default_shipping, created_at, updated_at)
    VALUES (org_id, 'Shipping', shipping[1], shipping[2], shipping[3], shipping[4], shipping[5], shipping[6],
            true, created_at, updated_at);
  END IF;

  INSERT INTO accounts (organization_id, type, payment_terms, billing_address_id, discord_id,
                        legacy_address, notes, legacy_customer_id, legacy_vendor_id,
                        is_archived, created_at, updated_at)
  VALUES (
    org_id, legacy_type::account_type, payment_terms, billing_id, discord_id,
    legacy_address, legacy_notes,
    CASE WHEN legacy_type = 'customer' THEN legacy_id END,
    CASE WHEN legacy_type = 'vendor' THEN legacy_id END,
    is_archived, created_at, updated_at);

  RETURN org_id;
END
$fn$;
--> statement-breakpoint

DO $do$
DECLARE
  c record;
  v record;
  org_id uuid;
BEGIN
  FOR c IN
    SELECT * FROM customers
    WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.legacy_customer_id = customers.id)
    ORDER BY id
  LOOP
    org_id := pg_temp.crm_backfill_party(
      'customer', c.id, c.display_name, c.company_name, c.contact_name, c.title, c.email, c.phone,
      ARRAY[c.billing_address_line1, c.billing_address_line2, c.billing_city, c.billing_state,
            c.billing_postal_code, c.billing_country],
      ARRAY[c.shipping_address_line1, c.shipping_address_line2, c.shipping_city, c.shipping_state,
            c.shipping_postal_code, c.shipping_country],
      c.payment_terms, NULL, NULL, NULL, c.is_archived, c.created_at, c.updated_at);

    -- Every alias the legacy Customer had moves to its Contact.
    INSERT INTO contact_email_aliases (contact_id, email, created_at)
    SELECT oc.contact_id, a.email, a.created_at
    FROM customer_email_aliases a
    JOIN organization_contacts oc ON oc.organization_id = org_id AND oc.is_primary
    WHERE a.customer_id = c.id
    ON CONFLICT DO NOTHING;

    INSERT INTO organization_attachments (organization_id, attachment_id, created_at)
    SELECT org_id, ca.attachment_id, ca.created_at
    FROM customer_attachments ca
    WHERE ca.customer_id = c.id
    ON CONFLICT DO NOTHING;

    -- Communications keep their id so reconciliation can check them row by row.
    INSERT INTO organization_communications (id, organization_id, method, note, created_by, created_at, is_archived)
    SELECT cc.id, org_id, cc.method, cc.note, cc.created_by, cc.created_at, cc.is_archived
    FROM customer_communications cc
    WHERE cc.customer_id = c.id
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR v IN
    SELECT * FROM vendors
    WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.legacy_vendor_id = vendors.id)
    ORDER BY id
  LOOP
    org_id := pg_temp.crm_backfill_party(
      'vendor', v.id, v.display_name, v.company_name, v.contact_name, v.title, v.email, v.phone,
      ARRAY[v.billing_address_line1, v.billing_address_line2, v.billing_city, v.billing_state,
            v.billing_postal_code, v.billing_country],
      ARRAY[v.shipping_address_line1, v.shipping_address_line2, v.shipping_city, v.shipping_state,
            v.shipping_postal_code, v.shipping_country],
      v.payment_terms, v.discord_id, v.address, v.notes, v.is_archived, v.created_at, v.updated_at);

    INSERT INTO organization_attachments (organization_id, attachment_id, created_at)
    SELECT org_id, va.attachment_id, va.created_at
    FROM vendor_attachments va
    WHERE va.vendor_id = v.id
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$do$;
--> statement-breakpoint

-- Merge chains still resolve: A merged into B becomes Organization A merged into Organization B.
UPDATE organizations o
SET merged_into_organization_id = target.id
FROM customers c
JOIN organizations target ON target.legacy_customer_id = c.merged_into_customer_id
WHERE o.legacy_customer_id = c.id
  AND c.merged_into_customer_id IS NOT NULL
  AND o.merged_into_organization_id IS NULL;
--> statement-breakpoint

UPDATE quotes q SET customer_account_id = a.id
FROM accounts a
WHERE a.legacy_customer_id = q.customer_id AND q.customer_account_id IS NULL;
--> statement-breakpoint
UPDATE quotes q SET vendor_account_id = a.id
FROM accounts a
WHERE a.legacy_vendor_id = q.vendor_id AND q.vendor_account_id IS NULL;
--> statement-breakpoint
UPDATE orders o SET customer_account_id = a.id
FROM accounts a
WHERE a.legacy_customer_id = o.customer_id AND o.customer_account_id IS NULL;
--> statement-breakpoint
UPDATE orders o SET vendor_account_id = a.id
FROM accounts a
WHERE a.legacy_vendor_id = o.vendor_id AND o.vendor_account_id IS NULL;
--> statement-breakpoint
UPDATE parts p SET customer_account_id = a.id
FROM accounts a
WHERE a.legacy_customer_id = p.customer_id AND p.customer_account_id IS NULL;
--> statement-breakpoint

-- Polymorphic references: entity_type stays `customer` / `vendor`; entity_id
-- moves from the legacy integer to the account uuid. A row whose legacy
-- Customer or Vendor no longer exists keeps its integer id (reconciliation
-- lists it as orphaned).
UPDATE notes n SET entity_id = a.id::text
FROM accounts a
WHERE n.entity_type = 'customer' AND n.entity_id = a.legacy_customer_id::text;
--> statement-breakpoint
UPDATE notes n SET entity_id = a.id::text
FROM accounts a
WHERE n.entity_type = 'vendor' AND n.entity_id = a.legacy_vendor_id::text;
--> statement-breakpoint
UPDATE event_logs e SET entity_id = a.id::text
FROM accounts a
WHERE e.entity_type = 'customer' AND e.entity_id = a.legacy_customer_id::text;
--> statement-breakpoint
UPDATE event_logs e SET entity_id = a.id::text
FROM accounts a
WHERE e.entity_type = 'vendor' AND e.entity_id = a.legacy_vendor_id::text;
--> statement-breakpoint
UPDATE action_items i SET entity_id = a.id::text
FROM accounts a
WHERE i.entity_type = 'customer' AND i.entity_id = a.legacy_customer_id::text;
--> statement-breakpoint
UPDATE action_items i SET entity_id = a.id::text
FROM accounts a
WHERE i.entity_type = 'vendor' AND i.entity_id = a.legacy_vendor_id::text;
--> statement-breakpoint

-- Active Customer match reviews: candidate and attached ids become customer
-- account uuids. The integer ids are kept under `legacy*` keys. Resolved items
-- are left alone; their links resolve through the legacy-id redirect.
UPDATE action_items i
SET metadata = (i.metadata - 'createdCustomerId')
  || CASE
       WHEN i.metadata ? 'createdCustomerId'
         THEN jsonb_build_object('legacyCreatedCustomerId', i.metadata -> 'createdCustomerId')
       ELSE '{}'::jsonb
     END
  || jsonb_build_object(
       'legacyCandidateCustomerIds', i.metadata -> 'candidateCustomerIds',
       'candidateCustomerIds', coalesce((
         SELECT jsonb_agg(a.id::text ORDER BY a.legacy_customer_id)
         FROM accounts a
         WHERE a.legacy_customer_id IN (
           SELECT value::integer
           FROM jsonb_array_elements_text(coalesce(i.metadata -> 'candidateCustomerIds', '[]'::jsonb))
           WHERE value ~ '^[0-9]+$'
           UNION
           SELECT (i.metadata ->> 'createdCustomerId')::integer
           WHERE (i.metadata ->> 'createdCustomerId') ~ '^[0-9]+$'
         )
       ), '[]'::jsonb))
  || CASE
       WHEN (i.metadata ->> 'attachedCustomerId') ~ '^[0-9]+$' THEN jsonb_build_object(
         'legacyAttachedCustomerId', i.metadata -> 'attachedCustomerId',
         'attachedCustomerId', (
           SELECT to_jsonb(a.id::text) FROM accounts a
           WHERE a.legacy_customer_id = (i.metadata ->> 'attachedCustomerId')::integer))
       ELSE '{}'::jsonb
     END
WHERE i.type = 'customer_match_review'
  AND i.status = 'active'
  AND NOT (i.metadata ? 'legacyCandidateCustomerIds');
