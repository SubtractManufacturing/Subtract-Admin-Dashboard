/**
 * Reconciliation of the legacy `customers` / `vendors` tables against the
 * ADR-0013 model (deployment 1 only; removed with the legacy tables).
 *
 * Every legacy row is checked one by one rather than by counts, because work
 * done in the app after cutover (new Quotes, merges, edits) changes counts
 * legitimately. A finding is:
 * - `blocking`: the backfill missed or mis-mapped something; the legacy
 *   tables must not be dropped until it is fixed;
 * - `info`: a difference explained by work in the app after cutover, or by a
 *   legacy row that was already orphaned.
 */
import { sql } from "drizzle-orm";

import { db } from "../db";
import { normalizeEmail } from "../email-normalize";
import { addressIsFilled, blankToNull, organizationFromLegacy } from "./profile";
import { isUuid } from "./types";

export type FindingSeverity = "blocking" | "info";

export type ReconciliationFinding = {
  severity: FindingSeverity;
  legacyType: "customer" | "vendor" | "polymorphic";
  legacyId: number | null;
  legacyName: string | null;
  check: string;
  detail: string;
  /** Where to look in the app, when there is a record to open. */
  href: string | null;
};

export type ReconciliationCheck = {
  name: string;
  checked: number;
  blocking: number;
  info: number;
};

export type ReconciliationReport = {
  generatedAt: Date;
  cutoverAt: Date | null;
  legacyCustomers: number;
  legacyVendors: number;
  checks: ReconciliationCheck[];
  findings: ReconciliationFinding[];
  blocking: number;
  info: number;
  /** True only when nothing blocks dropping the legacy tables. */
  safeToDrop: boolean;
};

type Row = Record<string, unknown>;

async function rows<T extends Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const text = (value: unknown) => blankToNull(typeof value === "string" ? value : value == null ? null : String(value));
const same = (a: unknown, b: unknown) => (text(a) ?? "") === (text(b) ?? "");
/**
 * Raw SQL returns `timestamp` (without time zone) columns as strings. They
 * hold UTC, like drizzle's own timestamp mapping assumes, so parse them as UTC
 * rather than local time.
 */
export function parseDbTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const hasZone = /([zZ]|[+-]\d{2}(:?\d{2})?)$/.test(raw);
  const iso = raw.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const time = (value: unknown) => parseDbTimestamp(value)?.getTime() ?? 0;

type Org = {
  id: string;
  kind: string;
  name: string;
  is_archived: boolean;
  merged_into_organization_id: string | null;
  legacy_customer_id: number | null;
  legacy_vendor_id: number | null;
  updated_at: Date;
};
type Account = {
  id: string;
  organization_id: string;
  type: "customer" | "vendor";
  payment_terms: string | null;
  billing_address_id: string | null;
  discord_id: string | null;
  legacy_address: string | null;
  notes: string | null;
  legacy_customer_id: number | null;
  legacy_vendor_id: number | null;
  is_archived: boolean;
  updated_at: Date;
};

/** Run every check. Read-only. */
export async function runReconciliation(): Promise<ReconciliationReport> {
  const [
    legacyCustomers,
    legacyVendors,
    orgRows,
    accountRows,
    linkRows,
    contactRows,
    addressRows,
    aliasRows,
    cutoverRows,
  ] = await Promise.all([
    rows<Row>(sql`select * from customers order by id`),
    rows<Row>(sql`select * from vendors order by id`),
    rows<Org>(sql`select id, kind, name, is_archived, merged_into_organization_id, legacy_customer_id, legacy_vendor_id, updated_at from organizations`),
    rows<Account>(sql`select * from accounts`),
    rows<{ organization_id: string; contact_id: string; is_primary: boolean; is_archived: boolean }>(
      sql`select organization_id, contact_id, is_primary, is_archived from organization_contacts`,
    ),
    rows<{ id: string; name: string | null; title: string | null; email: string | null; phone: string | null; merged_into_contact_id: string | null; updated_at: Date }>(
      sql`select id, name, title, email, phone, merged_into_contact_id, updated_at from contacts`,
    ),
    rows<{ id: string; organization_id: string; line1: string | null; line2: string | null; city: string | null; state: string | null; postal_code: string | null; country: string | null; is_default_shipping: boolean; is_archived: boolean; updated_at: Date }>(
      sql`select * from addresses`,
    ),
    rows<{ contact_id: string; email: string }>(sql`select contact_id, email from contact_email_aliases`),
    rows<{ at: Date }>(sql`select min(created_at) as at from event_logs where entity_type = 'system' and entity_id = 'organizations_backfill'`),
  ]);
  const cutoverAt = parseDbTimestamp(cutoverRows[0]?.at);
  const cutover = cutoverAt?.getTime() ?? Number.POSITIVE_INFINITY;

  const orgById = new Map(orgRows.map((org) => [org.id, org]));
  const orgByLegacy = {
    customer: new Map(orgRows.filter((o) => o.legacy_customer_id !== null).map((o) => [Number(o.legacy_customer_id), o])),
    vendor: new Map(orgRows.filter((o) => o.legacy_vendor_id !== null).map((o) => [Number(o.legacy_vendor_id), o])),
  };
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const accountByLegacy = {
    customer: new Map(accountRows.filter((a) => a.legacy_customer_id !== null).map((a) => [Number(a.legacy_customer_id), a])),
    vendor: new Map(accountRows.filter((a) => a.legacy_vendor_id !== null).map((a) => [Number(a.legacy_vendor_id), a])),
  };
  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  const addressById = new Map(addressRows.map((a) => [a.id, a]));

  /** The Organization merge chain from `orgId` to its final survivor. */
  const orgChain = (orgId: string | undefined): string[] => {
    const chain: string[] = [];
    let current = orgId;
    while (current && !chain.includes(current)) {
      chain.push(current);
      current = orgById.get(current)?.merged_into_organization_id ?? undefined;
    }
    return chain;
  };
  /** Accounts a legacy link may now point at: the mapped one, or one along the merge chain. */
  const acceptableAccounts = (type: "customer" | "vendor", legacyId: number): Set<string> => {
    const mapped = accountByLegacy[type].get(legacyId);
    const ids = new Set<string>();
    if (!mapped) return ids;
    ids.add(mapped.id);
    for (const orgId of orgChain(orgByLegacy[type].get(legacyId)?.id)) {
      for (const account of accountRows) {
        if (account.organization_id === orgId && account.type === type) ids.add(account.id);
      }
    }
    return ids;
  };
  const contactChain = (contactId: string): string[] => {
    const chain: string[] = [];
    let current: string | null | undefined = contactId;
    while (current && !chain.includes(current)) {
      chain.push(current);
      current = contactById.get(current)?.merged_into_contact_id;
    }
    return chain;
  };

  const findings: ReconciliationFinding[] = [];
  const checks = new Map<string, ReconciliationCheck>();
  const tally = (name: string, outcome: FindingSeverity | null) => {
    const check = checks.get(name) ?? { name, checked: 0, blocking: 0, info: 0 };
    check.checked += 1;
    if (outcome) check[outcome] += 1;
    checks.set(name, check);
  };
  const report = (finding: ReconciliationFinding) => {
    findings.push(finding);
    tally(finding.check, finding.severity);
  };

  for (const type of ["customer", "vendor"] as const) {
    const legacyRows = type === "customer" ? legacyCustomers : legacyVendors;
    const base = type === "customer" ? "/customers" : "/vendors";
    for (const legacy of legacyRows) {
      const legacyId = Number(legacy.id);
      const legacyName = text(legacy.display_name);
      const org = orgByLegacy[type].get(legacyId);
      const account = accountByLegacy[type].get(legacyId);
      const href = account ? `${base}/${account.id}` : null;
      const at = { legacyType: type, legacyId, legacyName, href } as const;

      // Existence
      if (!org || !account) {
        report({ ...at, severity: "blocking", check: "Records exist", detail: `No ${org ? "account" : "Organization"} carries legacy id ${legacyId}` });
        continue;
      }
      const primaryLink = linkRows.find((l) => l.organization_id === org.id && l.is_primary && !l.is_archived);
      const contact = primaryLink ? contactById.get(primaryLink.contact_id) : undefined;
      const accountOrgOk = orgChain(org.id).includes(account.organization_id);
      if (!accountOrgOk) {
        report({ ...at, severity: "blocking", check: "Records exist", detail: "The account belongs to an unrelated Organization" });
      } else {
        tally("Records exist", null);
      }

      // Fields, unless the records were changed in the app after cutover.
      const billing = account.billing_address_id ? addressById.get(account.billing_address_id) : undefined;
      const shipping = addressRows.find((a) => a.organization_id === org.id && a.is_default_shipping && !a.is_archived);
      const touched = [org.updated_at, account.updated_at, contact?.updated_at, billing?.updated_at, shipping?.updated_at]
        .some((value) => value && time(value) > Math.max(time(legacy.updated_at), cutover));
      const mergedAway = org.merged_into_organization_id !== null && legacy.merged_into_customer_id == null;
      const expected = organizationFromLegacy({
        displayName: text(legacy.display_name),
        companyName: text(legacy.company_name),
        contactName: text(legacy.contact_name),
      });
      const differences: string[] = [];
      if (org.name !== expected.name) differences.push(`name "${org.name}" ≠ "${expected.name}"`);
      if (org.kind !== expected.kind) differences.push(`kind ${org.kind} ≠ ${expected.kind}`);
      if (!contact) differences.push("no primary Contact");
      else {
        if (!same(contact.name, expected.contactName)) differences.push(`contact name "${contact.name ?? ""}" ≠ "${expected.contactName ?? ""}"`);
        if (!same(contact.title, legacy.title)) differences.push("title");
        if (!same(contact.email, legacy.email)) differences.push(`email "${contact.email ?? ""}" ≠ "${text(legacy.email) ?? ""}"`);
        if (!same(contact.phone, legacy.phone)) differences.push("phone");
      }
      const legacyBilling = { line1: legacy.billing_address_line1, line2: legacy.billing_address_line2, city: legacy.billing_city, state: legacy.billing_state, postalCode: legacy.billing_postal_code } as Record<string, unknown>;
      const legacyShipping = { line1: legacy.shipping_address_line1, line2: legacy.shipping_address_line2, city: legacy.shipping_city, state: legacy.shipping_state, postalCode: legacy.shipping_postal_code } as Record<string, unknown>;
      const addressDiffers = (address: typeof billing, wanted: Record<string, unknown>) => {
        const filled = addressIsFilled(wanted as never);
        if (!filled) return Boolean(address && addressIsFilled({ line1: address.line1, city: address.city, state: address.state, postalCode: address.postal_code, line2: address.line2 }));
        if (!address) return true;
        return !(same(address.line1, wanted.line1) && same(address.line2, wanted.line2) && same(address.city, wanted.city) && same(address.state, wanted.state) && same(address.postal_code, wanted.postalCode));
      };
      if (addressDiffers(billing, legacyBilling)) differences.push("billing address");
      if (addressDiffers(shipping, legacyShipping)) differences.push("shipping address");
      if (!same(account.payment_terms, legacy.payment_terms)) differences.push("payment terms");
      if (type === "vendor") {
        if (!same(account.discord_id, legacy.discord_id)) differences.push("Discord id");
        if (!same(account.legacy_address, legacy.address)) differences.push("legacy address");
        if (!same(account.notes, legacy.notes)) differences.push("notes");
      }
      if (Boolean(legacy.is_archived) && !account.is_archived) differences.push("legacy row is archived, account is active");
      if (differences.length === 0) tally("Fields match", null);
      else
        report({
          ...at,
          severity: touched || mergedAway ? "info" : "blocking",
          check: "Fields match",
          detail: `${touched || mergedAway ? "Changed in the app since cutover: " : ""}${differences.join("; ")}`,
        });

      // Merge pointers
      if (type === "customer" && legacy.merged_into_customer_id != null) {
        const target = orgByLegacy.customer.get(Number(legacy.merged_into_customer_id));
        if (!target || !orgChain(org.id).includes(target.id)) {
          report({ ...at, severity: "blocking", check: "Merge pointers", detail: `Legacy merge into ${legacy.merged_into_customer_id} is not carried over` });
        } else tally("Merge pointers", null);
      }
    }
  }

  // Links: every legacy foreign key resolves to the mapped account or its survivor.
  const linkChecks: Array<{ name: string; type: "customer" | "vendor"; query: ReturnType<typeof sql>; table: string }> = [
    { name: "Quotes", type: "customer", table: "quotes", query: sql`select id, customer_id as legacy_id, customer_account_id as account_id, updated_at from quotes where customer_id is not null` },
    { name: "Orders", type: "customer", table: "orders", query: sql`select id, order_number as ref, customer_id as legacy_id, customer_account_id as account_id, updated_at from orders where customer_id is not null` },
    { name: "Parts", type: "customer", table: "parts", query: sql`select id, customer_id as legacy_id, customer_account_id as account_id, updated_at from parts where customer_id is not null` },
    { name: "Vendor on Quotes", type: "vendor", table: "quotes", query: sql`select id, vendor_id as legacy_id, vendor_account_id as account_id, updated_at from quotes where vendor_id is not null` },
    { name: "Vendor on Orders", type: "vendor", table: "orders", query: sql`select id, order_number as ref, vendor_id as legacy_id, vendor_account_id as account_id, updated_at from orders where vendor_id is not null` },
  ];
  for (const check of linkChecks) {
    for (const row of await rows<{ id: string | number; ref?: string; legacy_id: number; account_id: string | null; updated_at: Date }>(check.query)) {
      const acceptable = acceptableAccounts(check.type, Number(row.legacy_id));
      const href = check.table === "quotes" ? `/quotes/${row.id}` : check.table === "orders" ? `/orders/${row.ref}` : null;
      const at = { legacyType: check.type, legacyId: Number(row.legacy_id), legacyName: null, href } as const;
      if (row.account_id && acceptable.has(row.account_id)) {
        tally(check.name, null);
      } else if (!row.account_id) {
        report({ ...at, severity: "blocking", check: check.name, detail: `${check.table} ${row.id} has no account` });
      } else {
        const changedLater = time(row.updated_at) > cutover;
        report({
          ...at,
          severity: changedLater ? "info" : "blocking",
          check: check.name,
          detail: `${check.table} ${row.id} points at a different account${changedLater ? " (changed in the app since cutover)" : ""}`,
        });
      }
    }
  }

  // Email aliases: each legacy alias is known by the Contact (or its merge survivor).
  const legacyAliases = await rows<{ customer_id: number; email: string }>(sql`select customer_id, email from customer_email_aliases`);
  for (const alias of legacyAliases) {
    const org = orgByLegacy.customer.get(Number(alias.customer_id));
    const chainOrgs = new Set(orgChain(org?.id));
    const contactIds = new Set(
      linkRows.filter((l) => chainOrgs.has(l.organization_id)).flatMap((l) => contactChain(l.contact_id)),
    );
    const wanted = normalizeEmail(alias.email) ?? alias.email;
    const found = aliasRows.some((row) => contactIds.has(row.contact_id) && row.email === wanted);
    if (found) tally("Email aliases", null);
    else
      report({
        legacyType: "customer",
        legacyId: Number(alias.customer_id),
        legacyName: null,
        href: accountByLegacy.customer.get(Number(alias.customer_id)) ? `/customers/${accountByLegacy.customer.get(Number(alias.customer_id))!.id}` : null,
        severity: "blocking",
        check: "Email aliases",
        detail: `Alias ${alias.email} is missing`,
      });
  }

  // Attachments: each legacy link is on the Organization, unless it was removed in the app.
  const unlinkedInApp = new Set(
    (
      await rows<{ attachment_id: string }>(
        sql`select metadata->>'attachmentId' as attachment_id from event_logs where event_type = 'attachment_unlinked' and metadata ? 'organizationId'`,
      )
    ).map((row) => row.attachment_id),
  );
  const orgAttachments = await rows<{ organization_id: string; attachment_id: string }>(sql`select organization_id, attachment_id from organization_attachments`);
  for (const type of ["customer", "vendor"] as const) {
    const legacyLinks = await rows<{ legacy_id: number; attachment_id: string }>(
      type === "customer"
        ? sql`select customer_id as legacy_id, attachment_id from customer_attachments`
        : sql`select vendor_id as legacy_id, attachment_id from vendor_attachments`,
    );
    for (const link of legacyLinks) {
      const chainOrgs = new Set(orgChain(orgByLegacy[type].get(Number(link.legacy_id))?.id));
      const present = orgAttachments.some((row) => chainOrgs.has(row.organization_id) && row.attachment_id === link.attachment_id);
      if (present) tally("Attachments", null);
      else
        report({
          legacyType: type,
          legacyId: Number(link.legacy_id),
          legacyName: null,
          href: null,
          severity: unlinkedInApp.has(link.attachment_id) ? "info" : "blocking",
          check: "Attachments",
          detail: unlinkedInApp.has(link.attachment_id)
            ? `Attachment ${link.attachment_id} was removed in the app since cutover`
            : `Attachment ${link.attachment_id} is not on the Organization`,
        });
    }
  }

  // Communications keep their ids.
  const missingCommunications = await rows<{ id: string; customer_id: number }>(sql`
    select cc.id, cc.customer_id from customer_communications cc
    where not exists (select 1 from organization_communications oc where oc.id = cc.id)
  `);
  const [{ total: communicationTotal }] = await rows<{ total: number }>(sql`select count(*)::int as total from customer_communications`);
  for (let i = 0; i < communicationTotal - missingCommunications.length; i++) tally("Communications", null);
  for (const row of missingCommunications) {
    report({ legacyType: "customer", legacyId: Number(row.customer_id), legacyName: null, href: null, severity: "blocking", check: "Communications", detail: `Communication ${row.id} was not copied` });
  }

  // Polymorphic rows: entity ids are account uuids now.
  for (const table of ["notes", "event_logs", "action_items"] as const) {
    const polymorphic = await rows<{ id: string; entity_type: "customer" | "vendor"; entity_id: string }>(
      sql`select id, entity_type, entity_id from ${sql.identifier(table)} where entity_type in ('customer', 'vendor')`,
    );
    for (const row of polymorphic) {
      const name = `Polymorphic ${table.replace("_", " ")}`;
      if (isUuid(row.entity_id) && accountById.get(row.entity_id)?.type === row.entity_type) {
        tally(name, null);
        continue;
      }
      const legacyExists = /^\d+$/.test(row.entity_id)
        && (row.entity_type === "customer" ? legacyCustomers : legacyVendors).some((legacy) => String(legacy.id) === row.entity_id);
      report({
        legacyType: "polymorphic",
        legacyId: /^\d+$/.test(row.entity_id) ? Number(row.entity_id) : null,
        legacyName: null,
        href: null,
        severity: legacyExists ? "blocking" : "info",
        check: name,
        detail: legacyExists
          ? `${table} ${row.id} still points at legacy ${row.entity_type} ${row.entity_id}`
          : `${table} ${row.id} points at ${row.entity_type} ${row.entity_id}, which no longer exists (orphaned before cutover)`,
      });
    }
  }

  // Active Customer match reviews use account uuids.
  const reviews = await rows<{ id: string; metadata: Record<string, unknown> }>(
    sql`select id, metadata from action_items where type = 'customer_match_review' and status = 'active' and not is_archived`,
  );
  for (const review of reviews) {
    const ids = Array.isArray(review.metadata?.candidateCustomerIds) ? (review.metadata.candidateCustomerIds as unknown[]) : [];
    if (ids.every((id) => typeof id === "string" && isUuid(id))) tally("Customer match reviews", null);
    else
      report({ legacyType: "polymorphic", legacyId: null, legacyName: null, href: "/ActionItems", severity: "blocking", check: "Customer match reviews", detail: `Action Item ${review.id} still holds integer Customer ids` });
  }

  const blocking = findings.filter((f) => f.severity === "blocking").length;
  return {
    generatedAt: new Date(),
    cutoverAt,
    legacyCustomers: legacyCustomers.length,
    legacyVendors: legacyVendors.length,
    checks: [...checks.values()],
    findings: findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1)),
    blocking,
    info: findings.length - blocking,
    safeToDrop: blocking === 0 && cutoverAt !== null,
  };
}
