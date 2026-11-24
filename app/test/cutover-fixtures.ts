/**
 * Seeding, snapshots and cleanup for the staged-cutover integration tests
 * (`*.serial.integration.test.ts`). All names and emails are made up.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, or, sql } from "drizzle-orm";

import { db } from "~/lib/db";
import {
  accounts,
  actionItems,
  addresses,
  attachments,
  contactEmailAliases,
  contacts,
  customerAttachments,
  customerCommunications,
  customerEmailAliases,
  customers,
  cutoverReviewMarks,
  eventLogs,
  notes,
  orders,
  organizationAttachments,
  organizationCommunications,
  organizationContacts,
  organizations,
  parts,
  quotes,
  users,
  vendorAttachments,
  vendors,
  type NewCustomer,
  type NewVendor,
} from "~/lib/db/schema";

export type CutoverFixture = ReturnType<typeof createCutoverFixture>;

/** Tracks what a test file seeds so it can remove exactly that afterwards. */
export function createCutoverFixture(prefix: string) {
  const tag = `${prefix}-${randomUUID().slice(0, 8)}`;
  const userId = `cutover-${tag}`;
  const customerIds: number[] = [];
  const vendorIds: number[] = [];
  const quoteIds: number[] = [];
  const orderIds: number[] = [];
  const partIds: string[] = [];
  const attachmentIds: string[] = [];
  const noteIds: string[] = [];
  const eventIds: string[] = [];
  const actionItemIds: string[] = [];
  let sequence = 0;
  const next = () => `${tag}-${++sequence}`;

  return {
    tag,
    userId,
    actor: { userId, email: `${userId}@example.invalid` },
    customerIds,
    vendorIds,
    quoteIds,
    orderIds,
    partIds,
    attachmentIds,

    async seedUser(role: "User" | "Admin" | "Dev" = "Admin") {
      await db
        .insert(users)
        .values({ id: userId, email: `${userId}@example.invalid`, role })
        .onConflictDoNothing();
    },

    async seedCustomer(values: Partial<NewCustomer> = {}, aliases: string[] = []) {
      const [row] = await db
        .insert(customers)
        .values({ displayName: `Customer ${next()}`, ...values })
        .returning();
      customerIds.push(row.id);
      if (aliases.length > 0) {
        await db
          .insert(customerEmailAliases)
          .values(aliases.map((email) => ({ customerId: row.id, email })));
      }
      return row;
    },

    async seedVendor(values: Partial<NewVendor> = {}) {
      const [row] = await db
        .insert(vendors)
        .values({ displayName: `Vendor ${next()}`, ...values })
        .returning();
      vendorIds.push(row.id);
      return row;
    },

    async seedQuote(customerId: number, vendorId: number | null = null) {
      const [row] = await db
        .insert(quotes)
        .values({ quoteNumber: `Q-${next()}`, customerId, vendorId })
        .returning();
      quoteIds.push(row.id);
      return row;
    },

    async seedOrder(customerId: number | null, vendorId: number | null = null) {
      const [row] = await db
        .insert(orders)
        .values({ orderNumber: `O-${next()}`, customerId, vendorId })
        .returning();
      orderIds.push(row.id);
      return row;
    },

    async seedPart(customerId: number | null) {
      const [row] = await db
        .insert(parts)
        .values({ partName: `Part ${next()}`, customerId })
        .returning();
      partIds.push(row.id);
      return row;
    },

    async seedAttachment(link: { customerIds?: number[]; vendorIds?: number[] }) {
      const [row] = await db
        .insert(attachments)
        .values({
          s3Bucket: "integration-test",
          s3Key: `cutover/${next()}.pdf`,
          fileName: "spec.pdf",
          contentType: "application/pdf",
        })
        .returning();
      attachmentIds.push(row.id);
      for (const customerId of link.customerIds ?? []) {
        await db.insert(customerAttachments).values({ customerId, attachmentId: row.id });
      }
      for (const vendorId of link.vendorIds ?? []) {
        await db.insert(vendorAttachments).values({ vendorId, attachmentId: row.id });
      }
      return row;
    },

    async seedCommunication(customerId: number, note = "Called about a quote") {
      const [row] = await db
        .insert(customerCommunications)
        .values({ customerId, method: "call", note, createdBy: userId })
        .returning();
      return row;
    },

    async seedNote(entityType: "customer" | "vendor", entityId: number) {
      const [row] = await db
        .insert(notes)
        .values({ entityType, entityId: String(entityId), content: "A note", createdBy: userId })
        .returning();
      noteIds.push(row.id);
      return row;
    },

    async seedEvent(entityType: "customer" | "vendor", entityId: number) {
      const [row] = await db
        .insert(eventLogs)
        .values({
          entityType,
          entityId: String(entityId),
          eventType: `${entityType}_created`,
          eventCategory: "system",
          title: "Created",
        })
        .returning();
      eventIds.push(row.id);
      return row;
    },

    async seedMatchReview(quoteId: number, candidateCustomerIds: number[]) {
      const [row] = await db
        .insert(actionItems)
        .values({
          type: "customer_match_review",
          title: "Review",
          description: "Review",
          entityType: "quote",
          entityId: String(quoteId),
          metadata: {
            candidateCustomerIds,
            attachedCustomerId: candidateCustomerIds[0],
            quoteId,
          },
        })
        .returning();
      actionItemIds.push(row.id);
      return row;
    },

    async seedCustomerActionItem(customerId: number) {
      const [row] = await db
        .insert(actionItems)
        .values({
          type: "customer_match_review",
          title: "On a Customer",
          description: "On a Customer",
          entityType: "customer",
          entityId: String(customerId),
          status: "resolved",
        })
        .returning();
      actionItemIds.push(row.id);
      return row;
    },

    /** Remove everything this fixture seeded, and the copies Sync made of it. */
    async cleanup() {
      const customerStrings = customerIds.map(String);
      const vendorStrings = vendorIds.map(String);

      if (actionItemIds.length > 0) {
        await db.delete(actionItems).where(inArray(actionItems.id, actionItemIds));
      }
      if (noteIds.length > 0) await db.delete(notes).where(inArray(notes.id, noteIds));
      if (customerIds.length > 0) {
        await db.execute(sql`delete from notes where entity_type = 'customer' and entity_id in ${customerStrings}`);
        await db.execute(sql`delete from event_logs where entity_type = 'customer' and entity_id in ${customerStrings}`);
        await db.execute(sql`delete from quotes where customer_id in ${customerIds}`);
        await db.execute(sql`delete from orders where customer_id in ${customerIds}`);
        await db.execute(sql`delete from parts where customer_id in ${customerIds}`);
      }
      if (vendorIds.length > 0) {
        await db.execute(sql`delete from event_logs where entity_type = 'vendor' and entity_id in ${vendorStrings}`);
      }
      if (quoteIds.length > 0) await db.delete(quotes).where(inArray(quotes.id, quoteIds));
      if (orderIds.length > 0) await db.delete(orders).where(inArray(orders.id, orderIds));
      if (partIds.length > 0) await db.delete(parts).where(inArray(parts.id, partIds));
      if (eventIds.length > 0) await db.delete(eventLogs).where(inArray(eventLogs.id, eventIds));

      await deleteCopies({ customerIds, vendorIds });

      if (customerIds.length > 0) {
        await db.delete(customerCommunications).where(inArray(customerCommunications.customerId, customerIds));
        await db.delete(customerAttachments).where(inArray(customerAttachments.customerId, customerIds));
        await db.delete(customerEmailAliases).where(inArray(customerEmailAliases.customerId, customerIds));
        await db.update(customers).set({ mergedIntoCustomerId: null }).where(inArray(customers.id, customerIds));
        await db.delete(cutoverReviewMarks).where(
          sql`${cutoverReviewMarks.legacyType} = 'customer' and ${cutoverReviewMarks.legacyId} in ${customerIds}`,
        );
        await db.delete(customers).where(inArray(customers.id, customerIds));
      }
      if (vendorIds.length > 0) {
        await db.delete(vendorAttachments).where(inArray(vendorAttachments.vendorId, vendorIds));
        await db.delete(cutoverReviewMarks).where(
          sql`${cutoverReviewMarks.legacyType} = 'vendor' and ${cutoverReviewMarks.legacyId} in ${vendorIds}`,
        );
        await db.delete(vendors).where(inArray(vendors.id, vendorIds));
      }
      if (attachmentIds.length > 0) {
        await db.delete(attachments).where(inArray(attachments.id, attachmentIds));
      }
      // Sync, stage and review events this fixture's user caused.
      await db.delete(eventLogs).where(eq(eventLogs.userId, userId));
      await db.delete(cutoverReviewMarks).where(eq(cutoverReviewMarks.reviewedBy, userId));
      await db.delete(users).where(eq(users.id, userId));
    },
  };
}

/** Delete the copies of the given old rows straight from the new tables. */
export async function deleteCopies(ids: { customerIds: number[]; vendorIds: number[] }) {
  const conditions = [
    ...(ids.customerIds.length > 0 ? [inArray(organizations.legacyCustomerId, ids.customerIds)] : []),
    ...(ids.vendorIds.length > 0 ? [inArray(organizations.legacyVendorId, ids.vendorIds)] : []),
  ];
  if (conditions.length === 0) return;
  const organizationIds = (
    await db.select({ id: organizations.id }).from(organizations).where(or(...conditions))
  ).map((row) => row.id);
  if (organizationIds.length === 0) return;

  const accountIds = (
    await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.organizationId, organizationIds))
  ).map((row) => row.id);
  if (accountIds.length > 0) {
    await db.update(quotes).set({ customerAccountId: null }).where(inArray(quotes.customerAccountId, accountIds));
    await db.update(quotes).set({ vendorAccountId: null }).where(inArray(quotes.vendorAccountId, accountIds));
    await db.update(orders).set({ customerAccountId: null }).where(inArray(orders.customerAccountId, accountIds));
    await db.update(orders).set({ vendorAccountId: null }).where(inArray(orders.vendorAccountId, accountIds));
    await db.update(parts).set({ customerAccountId: null }).where(inArray(parts.customerAccountId, accountIds));
  }
  await db.delete(organizationAttachments).where(inArray(organizationAttachments.organizationId, organizationIds));
  await db.delete(organizationCommunications).where(inArray(organizationCommunications.organizationId, organizationIds));
  await db.delete(accounts).where(inArray(accounts.organizationId, organizationIds));
  await db.delete(addresses).where(inArray(addresses.organizationId, organizationIds));
  const contactIds = (
    await db
      .delete(organizationContacts)
      .where(inArray(organizationContacts.organizationId, organizationIds))
      .returning({ contactId: organizationContacts.contactId })
  ).map((row) => row.contactId);
  if (contactIds.length > 0) {
    await db.delete(contactEmailAliases).where(inArray(contactEmailAliases.contactId, contactIds));
    await db.delete(contacts).where(inArray(contacts.id, contactIds));
  }
  await db
    .update(organizations)
    .set({ mergedIntoOrganizationId: null })
    .where(inArray(organizations.mergedIntoOrganizationId, organizationIds));
  await db.delete(organizations).where(inArray(organizations.id, organizationIds));
}

async function dump(query: ReturnType<typeof sql>): Promise<string> {
  const [row] = await db.execute<{ rows: unknown }>(query);
  return JSON.stringify(row.rows);
}

/**
 * Every old table in full, and every column of `quotes`, `orders` and `parts`
 * except the account ids Sync is allowed to write.
 */
export async function snapshotOldData(): Promise<Record<string, string>> {
  const stripAccountIds = sql.raw(
    "- 'customer_account_id' - 'vendor_account_id'",
  );
  return {
    customers: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from customers t`),
    vendors: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from vendors t`),
    customer_email_aliases: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.customer_id, t.email), '[]') as rows from customer_email_aliases t`),
    customer_attachments: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.customer_id, t.attachment_id), '[]') as rows from customer_attachments t`),
    vendor_attachments: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.vendor_id, t.attachment_id), '[]') as rows from vendor_attachments t`),
    customer_communications: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from customer_communications t`),
    quotes: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) ${stripAccountIds} order by t.id), '[]') as rows from quotes t`),
    orders: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) ${stripAccountIds} order by t.id), '[]') as rows from orders t`),
    parts: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) - 'customer_account_id' order by t.id), '[]') as rows from parts t`),
  };
}

/** Notes, Event logs and Action Items in full. `exceptEventType` leaves out Sync's own record. */
export async function snapshotPolymorphic(exceptEventType?: string): Promise<Record<string, string>> {
  return {
    notes: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from notes t`),
    event_logs: await dump(
      sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from event_logs t where t.event_type is distinct from ${exceptEventType ?? null}`,
    ),
    action_items: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from action_items t`),
  };
}

/** Every new table in full. */
export async function snapshotNewData(): Promise<Record<string, string>> {
  return {
    organizations: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from organizations t`),
    contacts: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from contacts t`),
    organization_contacts: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from organization_contacts t`),
    contact_email_aliases: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.contact_id, t.email), '[]') as rows from contact_email_aliases t`),
    addresses: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from addresses t`),
    accounts: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from accounts t`),
    organization_attachments: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.organization_id, t.attachment_id), '[]') as rows from organization_attachments t`),
    organization_communications: await dump(sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') as rows from organization_communications t`),
    links: await dump(sql`
      select jsonb_build_object(
        'quotes', (select coalesce(jsonb_agg(jsonb_build_array(id, customer_account_id, vendor_account_id) order by id), '[]') from quotes),
        'orders', (select coalesce(jsonb_agg(jsonb_build_array(id, customer_account_id, vendor_account_id) order by id), '[]') from orders),
        'parts', (select coalesce(jsonb_agg(jsonb_build_array(id, customer_account_id) order by id), '[]') from parts)
      ) as rows`),
  };
}

/** The copy of one old row, read straight from the new tables. */
export async function readCopy(type: "customer" | "vendor", legacyId: number) {
  const [organization] = await db
    .select()
    .from(organizations)
    .where(
      type === "customer"
        ? eq(organizations.legacyCustomerId, legacyId)
        : eq(organizations.legacyVendorId, legacyId),
    );
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      type === "customer"
        ? eq(accounts.legacyCustomerId, legacyId)
        : eq(accounts.legacyVendorId, legacyId),
    );
  if (!organization || !account) return null;
  const links = await db
    .select()
    .from(organizationContacts)
    .where(eq(organizationContacts.organizationId, organization.id));
  const contactRows =
    links.length > 0
      ? await db.select().from(contacts).where(inArray(contacts.id, links.map((link) => link.contactId)))
      : [];
  const aliasRows =
    contactRows.length > 0
      ? await db
          .select()
          .from(contactEmailAliases)
          .where(inArray(contactEmailAliases.contactId, contactRows.map((contact) => contact.id)))
      : [];
  const addressRows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.organizationId, organization.id));
  const files = await db
    .select()
    .from(organizationAttachments)
    .where(eq(organizationAttachments.organizationId, organization.id));
  const communications = await db
    .select()
    .from(organizationCommunications)
    .where(eq(organizationCommunications.organizationId, organization.id));
  return {
    organization,
    account,
    links,
    contact: contactRows[0] ?? null,
    aliases: aliasRows.map((alias) => alias.email).sort(),
    billingAddress: addressRows.find((address) => address.id === account.billingAddressId) ?? null,
    shippingAddress: addressRows.find((address) => address.isDefaultShipping) ?? null,
    addresses: addressRows,
    fileIds: files.map((file) => file.attachmentId).sort(),
    communicationIds: communications.map((communication) => communication.id).sort(),
  };
}
