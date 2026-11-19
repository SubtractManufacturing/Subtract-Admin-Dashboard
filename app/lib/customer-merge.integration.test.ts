/**
 * Integration tests: Organization and Contact merging, duplicate suggestions
 * and Customer match reviews on the ADR-0013 model.
 *
 * Requires DATABASE_URL pointing at a disposable database synced with db:push.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActionItemsForUser, resolveActionItem } from "./action-items.server";
import type { Actor } from "./authorization/authorize";
import {
  findDuplicatePairs,
  findDuplicateContacts,
  getActiveOrganizationSummaries,
  mergeContacts,
  mergeOrganizations,
  pairsAmong,
  previewContactMerge,
  previewMerge,
} from "./customer-merge.server";
import { CustomerMergeError } from "./customer-merge-error";
import { db } from "./db";
import {
  accounts,
  actionItems,
  addresses,
  attachments,
  contactEmailAliases,
  contacts,
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
} from "./db/schema";
import {
  addAddress,
  addContact,
  archiveAccount,
  listOrganizationAddresses,
  listOrganizationContacts,
  loadAccountRecord,
  resolveFinalAccountId,
} from "./organizations/accounts.server";
import type { AccountProfileInput, VendorRecord } from "./organizations/types";
import { createTestCustomer, createTestVendor, deleteTestOrganizations } from "~/test/seed-organizations";

const tag = randomUUID().slice(0, 8);
const adminId = `merge-admin-${tag}`;
const userId = `merge-user-${tag}`;
const admin: Actor = { kind: "staff", userId: adminId, email: `${adminId}@example.test`, name: null, role: "Admin" };
const plainUser: Actor = { kind: "staff", userId, email: `${userId}@example.test`, name: null, role: "User" };

const orgIds: string[] = [];
const quoteIds: number[] = [];
const orderIds: number[] = [];
const partIds: string[] = [];
const attachmentIds: string[] = [];
const itemIds: string[] = [];

const emailAt = (local: string, domain = `${tag}.example.test`) => `${local}@${domain}`;

async function customer(input: AccountProfileInput & { name: string }) {
  const record = await createTestCustomer({ kind: "business", ...input });
  orgIds.push(record.organizationId);
  return record;
}

async function vendor(input: AccountProfileInput & { name: string }) {
  const record = await createTestVendor({ kind: "business", ...input });
  orgIds.push(record.organizationId);
  return record;
}

async function quoteFor(account: VendorRecord, vendorAccount?: VendorRecord) {
  const [row] = await db
    .insert(quotes)
    .values({
      quoteNumber: `MQ-${randomUUID().slice(0, 10)}`,
      customerAccountId: account.id,
      vendorAccountId: vendorAccount?.id ?? null,
    })
    .returning({ id: quotes.id });
  quoteIds.push(row.id);
  return row.id;
}

async function orderFor(account: VendorRecord) {
  const [row] = await db
    .insert(orders)
    .values({ orderNumber: `MO-${randomUUID().slice(0, 10)}`, customerAccountId: account.id })
    .returning({ id: orders.id });
  orderIds.push(row.id);
  return row.id;
}

async function attachmentOn(...orgs: VendorRecord[]) {
  const [row] = await db
    .insert(attachments)
    .values({ s3Bucket: "b", s3Key: `${tag}/${randomUUID()}`, fileName: "nda.pdf", contentType: "application/pdf" })
    .returning({ id: attachments.id });
  attachmentIds.push(row.id);
  for (const org of orgs) {
    await db.insert(organizationAttachments).values({ organizationId: org.organizationId, attachmentId: row.id });
  }
  return row.id;
}

function pairOf<T extends { a: { id: string }; b: { id: string } }>(pairs: T[], x: VendorRecord, y: VendorRecord) {
  return pairs.find(
    (pair) =>
      (pair.a.id === x.organizationId && pair.b.id === y.organizationId) ||
      (pair.a.id === y.organizationId && pair.b.id === x.organizationId),
  );
}

async function previewThenMerge(survivor: VendorRecord, merged: VendorRecord, choices = {}) {
  const preview = await previewMerge({ survivorId: survivor.organizationId, mergedId: merged.organizationId });
  return mergeOrganizations(
    {
      survivorId: survivor.organizationId,
      mergedId: merged.organizationId,
      choices,
      expected: { survivorUpdatedAt: preview.survivorUpdatedAt, mergedUpdatedAt: preview.mergedUpdatedAt },
    },
    admin,
  );
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await db.insert(users).values([
    { id: adminId, email: admin.kind === "staff" ? admin.email : "", role: "Admin" },
    { id: userId, email: `${userId}@example.test`, role: "User" },
  ]);
});

afterAll(async () => {
  if (itemIds.length) await db.delete(actionItems).where(inArray(actionItems.id, itemIds));
  if (quoteIds.length) await db.delete(quotes).where(inArray(quotes.id, quoteIds));
  if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
  if (partIds.length) await db.delete(parts).where(inArray(parts.id, partIds));
  await db.delete(organizationCommunications).where(inArray(organizationCommunications.createdBy, [adminId, userId]));
  await deleteTestOrganizations(orgIds);
  if (attachmentIds.length) await db.delete(attachments).where(inArray(attachments.id, attachmentIds));
  await db.delete(eventLogs).where(inArray(eventLogs.userId, [adminId, userId]));
  await db.delete(users).where(inArray(users.id, [adminId, userId]));
});

describe("duplicate suggestions", () => {
  it("pairs Organizations whose Contacts share an email after normalization", async () => {
    const a = await customer({ name: `Email A ${tag}`, email: ` ${emailAt("jane").toUpperCase()} ` });
    const b = await customer({ name: `Email B ${tag}`, email: emailAt("jane") });
    const pair = pairOf((await findDuplicatePairs()).pairs, a, b);
    expect(pair?.reasons).toContainEqual({ kind: "email", value: emailAt("jane") });
  });

  it("suggests two people at one business domain, the strongest hint they are one company", async () => {
    const domain = `widgets-${tag}.example.com`;
    const jane = await customer({ name: `Jane ${tag}`, kind: "individual", contactName: "Jane", email: `jane@${domain}` });
    const bob = await customer({ name: `Bob ${tag}`, kind: "individual", contactName: "Bob", email: `bob@${domain}` });
    const pair = pairOf((await findDuplicatePairs({ kinds: ["domain"] })).pairs, jane, bob);
    expect(pair?.reasons).toEqual([{ kind: "domain", value: domain }]);
    expect(pair?.score).toBe(50);
  });

  it("never treats a free mailbox provider as a shared domain", async () => {
    const x = await customer({ name: `Free X ${tag}`, email: `x-${tag}@gmail.com` });
    const y = await customer({ name: `Free Y ${tag}`, email: `y-${tag}@gmail.com` });
    expect(pairOf((await findDuplicatePairs()).pairs, x, y)).toBeUndefined();
  });

  it("matches company names, phones and contact names, and ranks email above them", async () => {
    const one = await customer({ name: `Acme ${tag} Inc.`, phone: "(555) 010-1234", contactName: `Pat ${tag}` });
    const two = await customer({ name: `ACME ${tag} inc`, phone: "555.010.1234", contactName: `pat ${tag}` });
    const pair = pairOf((await findDuplicatePairs()).pairs, one, two);
    expect(pair?.reasons.map((reason) => reason.kind).sort()).toEqual(["company", "name", "phone"]);
    expect(pair?.score).toBe(35 + 45 + 30);
  });

  it("excludes archived Organizations", async () => {
    const live = await customer({ name: `Live ${tag}`, email: emailAt("archived-dupe") });
    const gone = await customer({ name: `Gone ${tag}`, email: emailAt("archived-dupe") });
    await archiveAccount(gone.id);
    expect(pairOf((await findDuplicatePairs()).pairs, live, gone)).toBeUndefined();
  });

  it("scopes suggestions to Vendors, or to both Customers and Vendors", async () => {
    const buyer = await customer({ name: `Both Ways ${tag}`, email: emailAt("both") });
    const shop = await vendor({ name: `Both Ways ${tag} Shop`, email: emailAt("both") });
    expect(pairOf((await findDuplicatePairs({ scope: "customers" })).pairs, buyer, shop)).toBeUndefined();
    expect(pairOf((await findDuplicatePairs({ scope: "vendors" })).pairs, buyer, shop)).toBeUndefined();
    const pair = pairOf((await findDuplicatePairs({ scope: "all" })).pairs, buyer, shop);
    expect(pair).toBeDefined();
    expect([pair!.a.vendorAccountId, pair!.b.vendorAccountId]).toContain(shop.id);
  });

  it("pairs Action Item candidates even when they share nothing, resolving legacy ids too", async () => {
    const a = await customer({ name: `Cand A ${tag}` });
    const b = await customer({ name: `Cand B ${tag}` });
    const summaries = await getActiveOrganizationSummaries([a.id, b.id, a.id]);
    expect(summaries.map((s) => s.id).sort()).toEqual([a.organizationId, b.organizationId].sort());
    expect(pairsAmong(summaries)).toHaveLength(1);
  });
});

describe("Organization merge", () => {
  it("makes two people at one company one Customer with two Contacts", async () => {
    const domain = `twopeople-${tag}.example.com`;
    const acme = await customer({ name: `Two People ${tag}`, contactName: "Jane", email: `jane@${domain}`, paymentTerms: "Net 30" });
    const bob = await customer({ name: `Bob Individual ${tag}`, kind: "individual", contactName: "Bob", email: `bob@${domain}` });
    const quoteId = await quoteFor(bob);
    const orderId = await orderFor(bob);
    const [part] = await db.insert(parts).values({ partName: "p", customerAccountId: bob.id }).returning({ id: parts.id });
    partIds.push(part.id);
    const [note] = await db
      .insert(notes)
      .values({ entityType: "customer", entityId: bob.id, content: "note", createdBy: adminId })
      .returning({ id: notes.id });
    await db.insert(organizationCommunications).values({
      organizationId: bob.organizationId,
      method: "call",
      note: "called",
      createdBy: adminId,
    });

    const preview = await previewMerge({ survivorId: acme.organizationId, mergedId: bob.organizationId });
    expect(preview.counts).toMatchObject({ quotes: 1, orders: 1, parts: 1, contacts: 1, communications: 1, notes: 1 });
    expect(preview.accounts).toEqual([
      { type: "customer", mode: "fold" },
      { type: "vendor", mode: "none" },
    ]);
    expect(preview.retainedEmails).toEqual([`bob@${domain}`, `jane@${domain}`]);

    const result = await previewThenMerge(acme, bob);
    expect(result.survivorCustomerAccountId).toBe(acme.id);

    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    const [movedPart] = await db.select().from(parts).where(eq(parts.id, part.id));
    const [movedNote] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(quote.customerAccountId).toBe(acme.id);
    expect(order.customerAccountId).toBe(acme.id);
    expect(movedPart.customerAccountId).toBe(acme.id);
    expect(movedNote.entityId).toBe(acme.id);

    const people = await listOrganizationContacts(acme.organizationId);
    expect(people.map((c) => [c.name, c.isPrimary])).toEqual([
      ["Jane", true],
      ["Bob", false],
    ]);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, bob.organizationId));
    expect(org).toMatchObject({ isArchived: true, mergedIntoOrganizationId: acme.organizationId });
    expect((await loadAccountRecord("customer", bob.id))?.isArchived).toBe(true);
    expect(await resolveFinalAccountId(bob.id)).toBe(acme.id);
    expect((await loadAccountRecord("customer", acme.id))?.paymentTerms).toBe("Net 30");

    const [event] = await db
      .select()
      .from(eventLogs)
      .where(and(eq(eventLogs.entityId, acme.id), eq(eventLogs.eventType, "organizations_merged")));
    expect(event.metadata).toMatchObject({ survivorOrganizationId: acme.organizationId, counts: { quotes: 1 } });
  });

  it("lets an individual join a business, defaulting to the business's name and kind", async () => {
    const solo = await customer({ name: `Solo ${tag}`, kind: "individual", contactName: `Solo ${tag}` });
    const biz = await customer({ name: `Big Co ${tag}`, kind: "business" });
    const preview = await previewMerge({ survivorId: solo.organizationId, mergedId: biz.organizationId });
    expect(preview.conflicts.find((c) => c.field === "kind")?.defaultChoice).toBe("merged");

    await previewThenMerge(solo, biz);
    const after = await loadAccountRecord("customer", solo.id);
    expect(after).toMatchObject({ kind: "business", displayName: `Big Co ${tag}` });
  });

  it("moves an account the survivor lacks, keeping its id: a Customer and a Vendor become one business", async () => {
    const buyer = await customer({ name: `Dual ${tag}`, email: emailAt("dual-buyer") });
    const shop = await vendor({ name: `Dual ${tag} Machining`, email: emailAt("dual-shop"), discordId: "42" });
    const vendorQuote = await quoteFor(buyer, shop);

    const preview = await previewMerge({ survivorId: buyer.organizationId, mergedId: shop.organizationId });
    expect(preview.accounts).toEqual([
      { type: "customer", mode: "none" },
      { type: "vendor", mode: "move" },
    ]);
    await previewThenMerge(buyer, shop);

    const movedVendor = await loadAccountRecord("vendor", shop.id);
    expect(movedVendor).toMatchObject({ organizationId: buyer.organizationId, isArchived: false, discordId: "42" });
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, vendorQuote));
    expect(quote.vendorAccountId).toBe(shop.id);
  });

  it("collapses a Contact already on both, keeps one default shipping address, and links shared files once", async () => {
    const keep = await customer({ name: `Keep ${tag}`, shippingAddressLine1: "1 Keep St", shippingCity: "A" });
    const fold = await customer({ name: `Fold ${tag}`, shippingAddressLine1: "2 Fold Rd", shippingCity: "B" });
    await db.insert(organizationContacts).values({ organizationId: fold.organizationId, contactId: (await addKeepContact(keep)) });
    const shared = await attachmentOn(keep, fold);
    const own = await attachmentOn(fold);

    const preview = await previewMerge({ survivorId: keep.organizationId, mergedId: fold.organizationId });
    expect(preview.contactsAlreadyLinked).toBe(1);
    expect(preview.attachmentsAlreadyLinked).toBe(1);
    expect(preview.conflicts.map((c) => c.field)).toContain("defaultShippingAddress");

    await previewThenMerge(keep, fold, { defaultShippingAddress: "merged" });
    const list = await listOrganizationAddresses(keep.organizationId);
    expect(list.filter((a) => a.isDefaultShipping).map((a) => a.line1)).toEqual(["2 Fold Rd"]);
    expect(list).toHaveLength(2);
    const files = await db
      .select()
      .from(organizationAttachments)
      .where(eq(organizationAttachments.organizationId, keep.organizationId));
    expect(files.map((f) => f.attachmentId).sort()).toEqual([shared, own].sort());
    const links = await db
      .select()
      .from(organizationContacts)
      .where(and(eq(organizationContacts.organizationId, keep.organizationId), eq(organizationContacts.isArchived, false)));
    expect(new Set(links.map((l) => l.contactId)).size).toBe(links.length);
  });

  it("requires an explicit choice when payment terms differ, and applies it", async () => {
    const a = await customer({ name: `Terms A ${tag}`, paymentTerms: "Net 30" });
    const b = await customer({ name: `Terms B ${tag}`, paymentTerms: "Net 60" });
    await expect(previewThenMerge(a, b)).rejects.toMatchObject({ status: 400 });
    await previewThenMerge(a, b, { customerPaymentTerms: "merged" });
    expect((await loadAccountRecord("customer", a.id))?.paymentTerms).toBe("Net 60");
  });

  it("keeps the survivor's billing address unless staff pick the merged one", async () => {
    const a = await customer({ name: `Bill A ${tag}`, billingAddressLine1: "1 Bill A" });
    const b = await customer({ name: `Bill B ${tag}`, billingAddressLine1: "2 Bill B" });
    await previewThenMerge(a, b, { customerBillingAddress: "merged" });
    expect((await loadAccountRecord("customer", a.id))?.billingAddressLine1).toBe("2 Bill B");
  });

  describe("safety", () => {
    it("refuses self-merges, archived sides and already-merged Organizations", async () => {
      const a = await customer({ name: `Safe A ${tag}` });
      const b = await customer({ name: `Safe B ${tag}` });
      await expect(previewMerge({ survivorId: a.organizationId, mergedId: a.organizationId })).rejects.toBeInstanceOf(CustomerMergeError);
      await previewThenMerge(a, b);
      await expect(previewMerge({ survivorId: a.organizationId, mergedId: b.organizationId })).rejects.toMatchObject({ status: 409 });
    });

    it("refuses when either side changed after the preview", async () => {
      const a = await customer({ name: `Stale A ${tag}` });
      const b = await customer({ name: `Stale B ${tag}` });
      const preview = await previewMerge({ survivorId: a.organizationId, mergedId: b.organizationId });
      await addContact(b.organizationId, { name: "Late addition" });
      await expect(
        mergeOrganizations(
          {
            survivorId: a.organizationId,
            mergedId: b.organizationId,
            expected: { survivorUpdatedAt: preview.survivorUpdatedAt, mergedUpdatedAt: preview.mergedUpdatedAt },
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("only lets Admin or Dev merge, through authorize()", async () => {
      const a = await customer({ name: `Auth A ${tag}` });
      const b = await customer({ name: `Auth B ${tag}` });
      await expect(
        mergeOrganizations({ survivorId: a.organizationId, mergedId: b.organizationId }, plainUser),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        mergeContacts({ survivorId: a.primaryContactId ?? "", mergedId: b.primaryContactId ?? "" }, plainUser),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});

async function addKeepContact(keep: VendorRecord) {
  return addContact(keep.organizationId, { name: `Shared ${tag}`, email: emailAt("shared-person") });
}

describe("Contact merge", () => {
  it("turns the same person twice into one Contact with both emails and both Organizations", async () => {
    const first = await customer({ name: `Person Org 1 ${tag}`, contactName: "Jane Doe", email: emailAt("jane.one") });
    const second = await customer({ name: `Person Org 2 ${tag}`, contactName: "Jane D.", email: emailAt("jane.two"), phone: "555" });
    await db.insert(organizationCommunications).values({
      organizationId: second.organizationId,
      contactId: second.primaryContactId,
      method: "email",
      note: "hi",
      createdBy: adminId,
    });

    const preview = await previewContactMerge({ survivorId: first.primaryContactId!, mergedId: second.primaryContactId! });
    expect(preview.retainedEmails).toEqual([emailAt("jane.one"), emailAt("jane.two")]);
    expect(preview.joinsOrganizations.map((o) => o.id)).toEqual([second.organizationId]);
    expect(preview.communications).toBe(1);
    expect(preview.conflicts.map((c) => c.field)).toEqual(["name", "email"]);

    await mergeContacts(
      {
        survivorId: first.primaryContactId!,
        mergedId: second.primaryContactId!,
        choices: { name: "survivor", email: "survivor" },
        expected: { survivorUpdatedAt: preview.survivorUpdatedAt, mergedUpdatedAt: preview.mergedUpdatedAt },
      },
      admin,
    );

    const [survivor] = await db.select().from(contacts).where(eq(contacts.id, first.primaryContactId!));
    const [merged] = await db.select().from(contacts).where(eq(contacts.id, second.primaryContactId!));
    expect(survivor).toMatchObject({ name: "Jane Doe", phone: "555" });
    expect(merged).toMatchObject({ isArchived: true, mergedIntoContactId: survivor.id });
    const aliases = await db.select().from(contactEmailAliases).where(eq(contactEmailAliases.contactId, survivor.id));
    expect(aliases.map((a) => a.email).sort()).toEqual([emailAt("jane.one"), emailAt("jane.two")]);
    // The survivor is now the primary Contact of the second Organization too.
    expect((await loadAccountRecord("customer", second.id))?.contactName).toBe("Jane Doe");
    const [comm] = await db
      .select()
      .from(organizationCommunications)
      .where(eq(organizationCommunications.organizationId, second.organizationId));
    expect(comm.contactId).toBe(survivor.id);
  });

  it("flags Contacts on one Organization that share an email or name", async () => {
    const org = await customer({ name: `Dupes ${tag}`, contactName: "Al", email: emailAt("al") });
    await addContact(org.organizationId, { name: "Albert", email: emailAt("al") });
    const pairs = await findDuplicateContacts(org.organizationId);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toBe("email");
  });
});

describe("Customer match review Action Items", () => {
  it("resolves once its candidates are merged, and only Admin or Dev resolve by hand", async () => {
    const a = await customer({ name: `Review A ${tag}` });
    const b = await customer({ name: `Review B ${tag}` });
    const c = await customer({ name: `Review C ${tag}` });
    const [merging] = await db
      .insert(actionItems)
      .values({ type: "customer_match_review", title: "r", description: "r", metadata: { candidateCustomerIds: [a.id, b.id] } })
      .returning({ id: actionItems.id });
    const [distinct] = await db
      .insert(actionItems)
      .values({ type: "customer_match_review", title: "r", description: "r", metadata: { candidateCustomerIds: [a.id, c.id] } })
      .returning({ id: actionItems.id });
    itemIds.push(merging.id, distinct.id);

    await previewThenMerge(a, b);
    const [resolved] = await db.select().from(actionItems).where(eq(actionItems.id, merging.id));
    expect(resolved).toMatchObject({ status: "resolved", resolution: "Customers merged" });

    await getActionItemsForUser(adminId);
    const [stillOpen] = await db.select().from(actionItems).where(eq(actionItems.id, distinct.id));
    expect(stillOpen.status).toBe("active");

    await expect(resolveActionItem(distinct.id, { userId, role: "User" })).rejects.toMatchObject({ status: 403 });
    await resolveActionItem(distinct.id, { userId: adminId, role: "Admin" });
    const [byHand] = await db.select().from(actionItems).where(eq(actionItems.id, distinct.id));
    expect(byHand).toMatchObject({ status: "resolved", resolution: "Not duplicates" });
  });

  it("leaves no addresses behind on the archived Organization", async () => {
    const a = await customer({ name: `Addr A ${tag}` });
    const b = await customer({ name: `Addr B ${tag}` });
    await addAddress(b.organizationId, { line1: "9 Side St" });
    await previewThenMerge(a, b);
    const left = await db.select().from(addresses).where(eq(addresses.organizationId, b.organizationId));
    expect(left).toHaveLength(0);
    const accountRows = await db.select().from(accounts).where(eq(accounts.organizationId, b.organizationId));
    expect(accountRows.every((row) => row.isArchived)).toBe(true);
  });
});
