/**
 * Integration test: the ADR-0013 backfill copies each legacy Customer and
 * Vendor one-to-one and is idempotent.
 *
 * Requires DATABASE_URL pointing at a disposable database synced with
 * `db:push`. Run via: DATABASE_URL=postgres://... npm run test:ci
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import {
  accounts,
  actionItems,
  addresses,
  attachments,
  contactEmailAliases,
  contacts,
  eventLogs,
  legacyCustomerAttachments,
  legacyCustomerCommunications,
  legacyCustomerEmailAliases,
  legacyCustomers,
  legacyVendorAttachments,
  legacyVendors,
  notes,
  orders,
  organizationAttachments,
  organizationCommunications,
  organizationContacts,
  organizations,
  parts,
  quotes,
  users,
} from "../db/schema";
import { getEnv } from "../env.server";
import { runOrganizationsBackfill } from "./backfill.server";

const run = `bf-${Date.now()}`;

type Seeded = {
  userId: string;
  businessId: number;
  individualId: number;
  mergedId: number;
  vendorId: number;
  quoteId: number;
  orderId: number;
  partId: string;
  attachmentId: string;
  vendorAttachmentId: string;
  communicationId: string;
  noteId: string;
  eventId: string;
  reviewId: string;
};

let seeded: Seeded;

/** Row counts owned by this file's legacy rows; other test files run in parallel. */
async function snapshot() {
  const legacyCustomerIds = [seeded.businessId, seeded.individualId, seeded.mergedId];
  const [row] = await db.execute<Record<string, number>>(sql`
    with orgs as (
      select id from organizations
      where legacy_customer_id in (${sql.join(legacyCustomerIds.map((id) => sql`${id}`), sql`, `)})
         or legacy_vendor_id = ${seeded.vendorId}
    ),
    links as (select * from organization_contacts where organization_id in (select id from orgs))
    select
      (select count(*)::int from orgs) as organizations,
      (select count(*)::int from links) as links,
      (select count(distinct contact_id)::int from links) as contacts,
      (select count(*)::int from contact_email_aliases where contact_id in (select contact_id from links)) as aliases,
      (select count(*)::int from addresses where organization_id in (select id from orgs)) as addresses,
      (select count(*)::int from accounts where organization_id in (select id from orgs)) as accounts,
      (select count(*)::int from organization_attachments where organization_id in (select id from orgs)) as attachments,
      (select count(*)::int from organization_communications where organization_id in (select id from orgs)) as communications
  `);
  return row;
}

async function orgFor(column: "customer" | "vendor", legacyId: number) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(
      column === "customer"
        ? eq(organizations.legacyCustomerId, legacyId)
        : eq(organizations.legacyVendorId, legacyId),
    );
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.organizationId, org.id));
  const links = await db
    .select({ link: organizationContacts, contact: contacts })
    .from(organizationContacts)
    .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
    .where(eq(organizationContacts.organizationId, org.id));
  const orgAddresses = await db
    .select()
    .from(addresses)
    .where(eq(addresses.organizationId, org.id));
  return { org, account, links, addresses: orgAddresses };
}

beforeAll(async () => {
  if (!getEnv("DATABASE_URL")) {
    throw new Error("DATABASE_URL is not set; point it at a disposable database.");
  }
  const userId = `${run}-user`;
  await db.insert(users).values({ id: userId, email: `${run}@example.test` });

  const [business, individual, merged] = await db
    .insert(legacyCustomers)
    .values([
      {
        displayName: "Jane Doe",
        companyName: "Acme Robotics",
        contactName: "Jane Doe",
        title: "Buyer",
        email: " Jane@Acme.test ",
        phone: "555-0100",
        billingAddressLine1: "1 Main St",
        billingCity: "Springfield",
        billingState: "IL",
        billingPostalCode: "62701",
        billingCountry: "US",
        shippingAddressLine1: "2 Dock Rd",
        shippingCity: "Springfield",
        shippingCountry: "US",
        paymentTerms: "Net 30",
      },
      { displayName: `Solo Buyer ${run}`, email: `solo-${run}@gmail.com` },
      { displayName: "Acme dup", companyName: "Acme Robotics", isArchived: true },
    ])
    .returning({ id: legacyCustomers.id });
  await db
    .update(legacyCustomers)
    .set({ mergedIntoCustomerId: business.id })
    .where(eq(legacyCustomers.id, merged.id));
  await db.insert(legacyCustomerEmailAliases).values([
    { customerId: business.id, email: "jane@acme.test" },
    { customerId: business.id, email: "jdoe@acme.test" },
  ]);

  const [vendor] = await db
    .insert(legacyVendors)
    .values({
      displayName: "Mill Shop",
      contactName: "Bob",
      email: "bob@mill.test",
      discordId: "1234",
      address: "Old free text address",
      notes: "Good at titanium",
      paymentTerms: "Net 15",
    })
    .returning({ id: legacyVendors.id });

  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber: `${run}-Q`,
      legacyCustomerId: business.id,
      legacyVendorId: vendor.id,
    })
    .returning({ id: quotes.id });
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `${run}-O`,
      legacyCustomerId: individual.id,
      legacyVendorId: vendor.id,
    })
    .returning({ id: orders.id });
  const [part] = await db
    .insert(parts)
    .values({ partName: `${run}-part`, legacyCustomerId: business.id })
    .returning({ id: parts.id });

  const [attachment, vendorAttachment] = await db
    .insert(attachments)
    .values([
      { s3Bucket: "b", s3Key: `${run}/nda.pdf`, fileName: "nda.pdf", contentType: "application/pdf" },
      { s3Bucket: "b", s3Key: `${run}/cert.pdf`, fileName: "cert.pdf", contentType: "application/pdf" },
    ])
    .returning({ id: attachments.id });
  await db
    .insert(legacyCustomerAttachments)
    .values({ customerId: business.id, attachmentId: attachment.id });
  await db
    .insert(legacyVendorAttachments)
    .values({ vendorId: vendor.id, attachmentId: vendorAttachment.id });
  const [communication] = await db
    .insert(legacyCustomerCommunications)
    .values({ customerId: business.id, method: "call", note: "Called", createdBy: userId })
    .returning({ id: legacyCustomerCommunications.id });

  const [note] = await db
    .insert(notes)
    .values({ entityType: "customer", entityId: String(business.id), content: "hi", createdBy: userId })
    .returning({ id: notes.id });
  const [event] = await db
    .insert(eventLogs)
    .values({
      entityType: "vendor",
      entityId: String(vendor.id),
      eventType: "vendor_created",
      eventCategory: "system",
      title: "Vendor created",
    })
    .returning({ id: eventLogs.id });
  const [review] = await db
    .insert(actionItems)
    .values({
      type: "customer_match_review",
      title: "Review",
      description: "Review",
      entityType: "quote",
      entityId: String(quote.id),
      metadata: {
        candidateCustomerIds: [business.id, individual.id],
        attachedCustomerId: business.id,
      },
    })
    .returning({ id: actionItems.id });

  seeded = {
    userId,
    businessId: business.id,
    individualId: individual.id,
    mergedId: merged.id,
    vendorId: vendor.id,
    quoteId: quote.id,
    orderId: order.id,
    partId: part.id,
    attachmentId: attachment.id,
    vendorAttachmentId: vendorAttachment.id,
    communicationId: communication.id,
    noteId: note.id,
    eventId: event.id,
    reviewId: review.id,
  };

  await runOrganizationsBackfill();
});

afterAll(async () => {
  if (!seeded) return;
  const orgIds = (
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        sql`${organizations.legacyCustomerId} in (${seeded.businessId}, ${seeded.individualId}, ${seeded.mergedId})
          or ${organizations.legacyVendorId} = ${seeded.vendorId}`,
      )
  ).map((row) => row.id);
  await db.delete(actionItems).where(eq(actionItems.id, seeded.reviewId));
  await db.delete(eventLogs).where(eq(eventLogs.id, seeded.eventId));
  await db.delete(notes).where(eq(notes.id, seeded.noteId));
  await db.delete(orders).where(eq(orders.id, seeded.orderId));
  await db.delete(quotes).where(eq(quotes.id, seeded.quoteId));
  await db.delete(parts).where(eq(parts.id, seeded.partId));
  await db.delete(organizationCommunications).where(eq(organizationCommunications.id, seeded.communicationId));
  await db.delete(legacyCustomerCommunications).where(eq(legacyCustomerCommunications.id, seeded.communicationId));
  if (orgIds.length > 0) {
    await db.delete(organizationAttachments).where(inArray(organizationAttachments.organizationId, orgIds));
    await db.update(accounts).set({ billingAddressId: null }).where(inArray(accounts.organizationId, orgIds));
    await db.delete(accounts).where(inArray(accounts.organizationId, orgIds));
    await db.delete(addresses).where(inArray(addresses.organizationId, orgIds));
    const contactIds = (
      await db
        .select({ id: organizationContacts.contactId })
        .from(organizationContacts)
        .where(inArray(organizationContacts.organizationId, orgIds))
    ).map((row) => row.id);
    await db.delete(organizationContacts).where(inArray(organizationContacts.organizationId, orgIds));
    if (contactIds.length > 0) {
      await db.delete(contactEmailAliases).where(inArray(contactEmailAliases.contactId, contactIds));
      await db.delete(contacts).where(inArray(contacts.id, contactIds));
    }
    await db.update(organizations).set({ mergedIntoOrganizationId: null }).where(inArray(organizations.id, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  await db.delete(legacyCustomerAttachments).where(eq(legacyCustomerAttachments.customerId, seeded.businessId));
  await db.delete(legacyVendorAttachments).where(eq(legacyVendorAttachments.vendorId, seeded.vendorId));
  await db.delete(attachments).where(inArray(attachments.id, [seeded.attachmentId, seeded.vendorAttachmentId]));
  await db.delete(legacyCustomerEmailAliases).where(eq(legacyCustomerEmailAliases.customerId, seeded.businessId));
  await db.update(legacyCustomers).set({ mergedIntoCustomerId: null }).where(eq(legacyCustomers.id, seeded.mergedId));
  await db.delete(legacyCustomers).where(
    inArray(legacyCustomers.id, [seeded.businessId, seeded.individualId, seeded.mergedId]),
  );
  await db.delete(legacyVendors).where(eq(legacyVendors.id, seeded.vendorId));
  await db.delete(users).where(eq(users.id, seeded.userId));
});

describe("organizations backfill", () => {
  it("turns a Customer with a company into a business Organization with one primary Contact", async () => {
    const { org, account, links, addresses: orgAddresses } = await orgFor("customer", seeded.businessId);
    expect(org).toMatchObject({ kind: "business", name: "Acme Robotics", isArchived: false });
    expect(account).toMatchObject({ type: "customer", paymentTerms: "Net 30", legacyCustomerId: seeded.businessId });
    expect(links).toHaveLength(1);
    expect(links[0].link.isPrimary).toBe(true);
    expect(links[0].contact).toMatchObject({ name: "Jane Doe", title: "Buyer", email: "Jane@Acme.test", phone: "555-0100" });

    const billing = orgAddresses.find((address) => address.id === account.billingAddressId);
    expect(billing).toMatchObject({ line1: "1 Main St", city: "Springfield", state: "IL", postalCode: "62701" });
    const shipping = orgAddresses.filter((address) => address.isDefaultShipping);
    expect(shipping).toHaveLength(1);
    expect(shipping[0]).toMatchObject({ line1: "2 Dock Rd" });
  });

  it("moves every alias to the Contact, normalized primary email included", async () => {
    const { links } = await orgFor("customer", seeded.businessId);
    const aliasRows = await db
      .select({ email: contactEmailAliases.email })
      .from(contactEmailAliases)
      .where(eq(contactEmailAliases.contactId, links[0].contact.id));
    expect(aliasRows.map((row) => row.email).sort()).toEqual(["jane@acme.test", "jdoe@acme.test"]);
  });

  it("makes a Customer without a company an individual Organization", async () => {
    const { org, links, addresses: orgAddresses, account } = await orgFor("customer", seeded.individualId);
    expect(org).toMatchObject({ kind: "individual", name: `Solo Buyer ${run}` });
    expect(links[0].contact.name).toBe(`Solo Buyer ${run}`);
    expect(orgAddresses).toHaveLength(0);
    expect(account.billingAddressId).toBeNull();
  });

  it("carries archived Customers over archived, with their merge pointer", async () => {
    const merged = await orgFor("customer", seeded.mergedId);
    const survivor = await orgFor("customer", seeded.businessId);
    expect(merged.org.isArchived).toBe(true);
    expect(merged.account.isArchived).toBe(true);
    expect(merged.org.mergedIntoOrganizationId).toBe(survivor.org.id);
    // No contact name when the display name only repeats the company.
    expect(merged.links[0].contact.name).toBe("Acme dup");
  });

  it("copies a Vendor into a vendor account with its vendor-only fields", async () => {
    const { org, account, links } = await orgFor("vendor", seeded.vendorId);
    expect(org).toMatchObject({ kind: "individual", name: "Mill Shop", legacyVendorId: seeded.vendorId });
    expect(account).toMatchObject({
      type: "vendor",
      discordId: "1234",
      legacyAddress: "Old free text address",
      notes: "Good at titanium",
      paymentTerms: "Net 15",
    });
    expect(links[0].contact.name).toBe("Bob");
  });

  it("points Quotes, Orders and Parts at the mapped accounts", async () => {
    const business = await orgFor("customer", seeded.businessId);
    const individual = await orgFor("customer", seeded.individualId);
    const vendor = await orgFor("vendor", seeded.vendorId);
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, seeded.quoteId));
    const [order] = await db.select().from(orders).where(eq(orders.id, seeded.orderId));
    const [part] = await db.select().from(parts).where(eq(parts.id, seeded.partId));
    expect(quote.customerAccountId).toBe(business.account.id);
    expect(quote.vendorAccountId).toBe(vendor.account.id);
    expect(order.customerAccountId).toBe(individual.account.id);
    expect(order.vendorAccountId).toBe(vendor.account.id);
    expect(part.customerAccountId).toBe(business.account.id);
  });

  it("moves attachments and communications to the Organization", async () => {
    const business = await orgFor("customer", seeded.businessId);
    const vendor = await orgFor("vendor", seeded.vendorId);
    const links = await db
      .select()
      .from(organizationAttachments)
      .where(inArray(organizationAttachments.organizationId, [business.org.id, vendor.org.id]));
    expect(links.map((link) => [link.organizationId, link.attachmentId]).sort()).toEqual(
      [
        [business.org.id, seeded.attachmentId],
        [vendor.org.id, seeded.vendorAttachmentId],
      ].sort(),
    );
    const [communication] = await db
      .select()
      .from(organizationCommunications)
      .where(eq(organizationCommunications.id, seeded.communicationId));
    expect(communication).toMatchObject({ organizationId: business.org.id, method: "call", note: "Called" });
  });

  it("rewrites polymorphic rows and active match reviews to account uuids", async () => {
    const business = await orgFor("customer", seeded.businessId);
    const individual = await orgFor("customer", seeded.individualId);
    const vendor = await orgFor("vendor", seeded.vendorId);
    const [note] = await db.select().from(notes).where(eq(notes.id, seeded.noteId));
    const [event] = await db.select().from(eventLogs).where(eq(eventLogs.id, seeded.eventId));
    const [review] = await db.select().from(actionItems).where(eq(actionItems.id, seeded.reviewId));
    expect(note).toMatchObject({ entityType: "customer", entityId: business.account.id });
    expect(event).toMatchObject({ entityType: "vendor", entityId: vendor.account.id });
    expect(review.metadata).toMatchObject({
      candidateCustomerIds: [business.account.id, individual.account.id],
      attachedCustomerId: business.account.id,
      legacyCandidateCustomerIds: [seeded.businessId, seeded.individualId],
      legacyAttachedCustomerId: seeded.businessId,
    });
  });

  it("changes nothing when run again", async () => {
    const before = await snapshot();
    const [reviewBefore] = await db.select().from(actionItems).where(eq(actionItems.id, seeded.reviewId));
    await runOrganizationsBackfill();
    expect(await snapshot()).toEqual(before);
    const [reviewAfter] = await db.select().from(actionItems).where(eq(actionItems.id, seeded.reviewId));
    expect(reviewAfter.metadata).toEqual(reviewBefore.metadata);
    const linked = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.legacyCustomerId, seeded.businessId)));
    expect(linked).toHaveLength(1);
  });
});
