-- ADR-0014: read-only pass over the old Customers and Vendors before the
-- staged cutover. Changes nothing.
--
-- Returns every active row with what the copy would turn it into
-- (`becomes_type`, `becomes_organization`, `becomes_contact`) and flags for the
-- rows that look wrong. Flagged rows sort first. Fix them in the app (the
-- Customer and Vendor forms, or Settings > bulk import with "modify").
--
-- The free mailbox list mirrors app/lib/organizations/free-email-domains.ts and
-- the rules mirror app/lib/organizations/mapping.ts, which the review list uses.
-- review.integration.test.ts runs this file and fails when they disagree.

SELECT
  r.kind, r.id, r.display_name, r.company_name, r.contact_name, r.email,
  CASE WHEN m.company IS NOT NULL THEN 'business' ELSE 'individual' END AS becomes_type,
  coalesce(m.company, m.shown) AS becomes_organization,
  coalesce(m.person, CASE WHEN m.company IS NULL OR m.shown IS DISTINCT FROM m.company THEN m.shown END)
    AS becomes_contact,
  f.flags
FROM (
  SELECT 'customer' AS kind, id, display_name, company_name, contact_name, email, is_archived FROM customers
  UNION ALL
  SELECT 'vendor', id, display_name, company_name, contact_name, email, is_archived FROM vendors
) r
CROSS JOIN (
  -- The characters JavaScript's String.prototype.trim() removes, so "blank"
  -- means the same here as in app/lib/organizations/mapping.ts.
  SELECT string_agg(chr(code), '') AS chars
  FROM unnest(ARRAY[9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198,
                    8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279]) AS code
) ws
CROSS JOIN LATERAL (
  SELECT
    nullif(btrim(r.company_name, ws.chars), '') AS company,
    nullif(btrim(r.contact_name, ws.chars), '') AS person,
    nullif(btrim(r.display_name, ws.chars), '') AS shown,
    split_part(lower(btrim(coalesce(r.email, ''), ws.chars)), '@', 2) AS domain
) m
CROSS JOIN LATERAL (
  SELECT array_remove(ARRAY[
    CASE WHEN m.company IS NULL AND r.display_name ~* '( - | – | / |\(| c/o | at | @ )'
         THEN 'no company, but the display name looks like company + person' END,
    CASE WHEN m.company IS NULL AND r.display_name ~*
              '\m(inc|llc|ltd|corp|mfg|manufacturing|machine|machining|tool|tools|engineering|industries|technologies|tech|robotics|design|products|solutions|enterprises|defense|welding|ventures|fabrication|precision)\M'
         THEN 'no company, but the display name reads like a business' END,
    CASE WHEN m.company IS NULL AND m.domain <> '' AND m.domain <> ALL (ARRAY[
              '163.com','126.com','aim.com','aol.com','att.net','bellsouth.net','btinternet.com','charter.net',
              'comcast.net','cox.net','earthlink.net','email.com','fastmail.com','fastmail.fm','frontier.com',
              'gmail.com','gmx.com','gmx.de','gmx.net','googlemail.com','hey.com','hotmail.co.uk','hotmail.com',
              'hotmail.fr','hushmail.com','icloud.com','inbox.com','juno.com','live.ca','live.co.uk','live.com',
              'mac.com','mail.com','mail.ru','me.com','msn.com','naver.com','netzero.net','optonline.net',
              'outlook.co.uk','outlook.com','pm.me','proton.me','protonmail.ch','protonmail.com','qq.com',
              'rocketmail.com','rogers.com','sbcglobal.net','shaw.ca','sky.com','tutanota.com','tuta.io',
              'verizon.net','web.de','windstream.net','yahoo.ca','yahoo.co.in','yahoo.co.jp','yahoo.co.uk',
              'yahoo.com','yahoo.com.au','yahoo.de','yahoo.fr','yandex.com','yandex.ru','ymail.com','zoho.com',
              'zohomail.com'])
         THEN 'no company, but a business email domain' END,
    CASE WHEN m.company IS NOT NULL AND m.person IS NULL AND m.shown IS DISTINCT FROM m.company
         THEN 'the Contact would be named after the display name' END,
    CASE WHEN m.company IS NOT NULL AND m.person IS NULL AND m.shown IS NOT DISTINCT FROM m.company
         THEN 'business with an unnamed Contact' END,
    CASE WHEN lower(m.person) = lower(m.company) THEN 'contact name repeats the company' END,
    CASE WHEN m.domain = '' THEN 'no email' END
  ], NULL) AS flags
) f
WHERE NOT r.is_archived
ORDER BY (cardinality(f.flags) = 0), r.kind, r.display_name;
