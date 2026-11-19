/**
 * Intake Customer resolution through the importer's import seam (ADR-0012,
 * ADR-0013): incoming emails match active Contacts and resolve to their
 * Organizations' customer accounts.
 * Requires DATABASE_URL pointing at a disposable database synced with db:push.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  accounts,
  actionItems,
  contactEmailAliases,
  organizationContacts,
  orders,
  quotes,
  users,
} from "../db/schema";
import { mergeOrganizations } from "../customer-merge.server";
import {
  archiveAccount,
  listOrganizationContacts,
  loadAccountRecord,
} from "../organizations/accounts.server";
import type { AccountProfileInput } from "../organizations/types";
import { createTestCustomer, createTestVendor, deleteTestOrganizations } from "~/test/seed-organizations";
import wordpressManifest from "./fixtures/wordpress-manifest.json";
import { createRfqImporter } from "./importer";
import { createPostgresRfqPersistence } from "./postgres.server";
import { MemoryStorage } from "./test-support/memory-storage";

const tag = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}-${tag}@example.invalid`;

const persistence = createPostgresRfqPersistence({
  attachmentBucket: "integration-test",
});

const createdQuoteIds: number[] = [];
const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];
const receiptNumbers: string[] = [];
const mergeActorId = `intake-merge-actor-${tag}`;
const mergeActor = {
  kind: "staff" as const,
  userId: mergeActorId,
  email: `${mergeActorId}@example.invalid`,
  name: null,
  role: "Admin" as const,
};

type Contact = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string | null;
  phone?: string | null;
};

let clock = Date.parse("2025-01-01T00:00:00Z");

async function seedCustomer(input: {
  email: string | null;
  aliases?: string[];
  name?: string;
  kind?: "business" | "individual";
  contactName?: string | null;
  phone?: string | null;
  isArchived?: boolean;
}) {
  clock += 1000;
  const profile: AccountProfileInput = {
    name: input.name ?? `Seed ${randomUUID().slice(0, 6)}`,
    kind: input.kind ?? "individual",
    contactName: input.contactName ?? null,
    email: input.email,
    phone: input.phone ?? null,
  };
  const customer = await createTestCustomer(profile, { now: new Date(clock) });
  createdOrganizationIds.push(customer.organizationId);
  if ((input.aliases ?? []).length > 0 && customer.primaryContactId) {
    await db
      .insert(contactEmailAliases)
      .values(input.aliases!.map((email) => ({ contactId: customer.primaryContactId!, email })))
      .onConflictDoNothing();
  }
  if (input.isArchived) await archiveAccount(customer.id);
  return customer;
}

async function seedQuoteFor(customerId: string, createdAt: Date) {
  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber: `T${randomUUID().slice(0, 10)}`,
      customerAccountId: customerId,
      status: "RFQ",
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: quotes.id });
  createdQuoteIds.push(quote.id);
  return quote.id;
}

async function seedOrderFor(customerId: string, createdAt: Date) {
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `T${randomUUID().slice(0, 10)}`,
      customerAccountId: customerId,
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: orders.id });
  return order.id;
}

/** Runs one WordPress RFQ submission through the importer; returns its Quote. */
async function submitRfq(contact: Contact) {
  const receiptNumber = `TEST-MATCH-${randomUUID()}`;
  receiptNumbers.push(receiptNumber);
  const sessionId = randomUUID();
  const receiptKey = `intake/${sessionId}/meta/receipt.json`;
  const manifestKey = `intake/${sessionId}/meta/manifest.json`;
  const cadKey = `intake/${sessionId}/parts/${randomUUID()}_bracket.step`;

  const storage = new MemoryStorage();
  storage.put(receiptKey, {
    receipt_number: receiptNumber,
    session_id: sessionId,
    submitted_at: "2026-09-21T11:00:00+00:00",
    manifest_key: manifestKey,
  });
  storage.put(manifestKey, {
    ...wordpressManifest,
    session_id: sessionId,
    contact: {
      first_name: contact.firstName ?? "Jane",
      last_name: contact.lastName ?? "Smith",
      company: contact.company ?? null,
      email: contact.email,
      phone: contact.phone ?? null,
      phone_country_code: "1",
      job_title: null,
    },
    parts: [
      {
        ...wordpressManifest.parts[0],
        part_id: randomUUID(),
        part_file_key: cadKey,
        drawing_file_keys: [],
      },
    ],
  });
  storage.put(cadKey, "STEP", "application/step");

  const importer = createRfqImporter({
    ...storage.buckets,
    persistence,
    queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
    now: () => new Date("2026-09-21T00:00:00Z"),
  });
  const outcome = await importer.importReceipt(receiptKey);
  if (outcome.status !== "completed") {
    throw new Error(`Import did not complete: ${JSON.stringify(outcome)}`);
  }
  createdQuoteIds.push(outcome.quoteId);
  const [quote] = await db
    .select({ id: quotes.id, customerId: quotes.customerAccountId })
    .from(quotes)
    .where(eq(quotes.id, outcome.quoteId));
  if (quote.customerId) {
    const [account] = await db
      .select({ organizationId: accounts.organizationId })
      .from(accounts)
      .where(eq(accounts.id, quote.customerId));
    if (account) createdOrganizationIds.push(account.organizationId);
  }
  return { quoteId: quote.id, customerId: quote.customerId! };
}

/** Active customer accounts whose Organization lists a Contact with this primary email. */
async function customersWithEmail(email: string) {
  return db.execute(sql`
    select distinct a.id from accounts a
    join organization_contacts oc on oc.organization_id = a.organization_id and not oc.is_archived
    join contacts c on c.id = oc.contact_id
    where a.type = 'customer' and not a.is_archived and lower(trim(c.email)) = ${email}
  `) as unknown as Promise<Array<{ id: string }>>;
}

async function reviewItemsFor(quoteId: number) {
  return db
    .select()
    .from(actionItems)
    .where(
      sql`${actionItems.type} = 'customer_match_review' and ${actionItems.entityType} = 'quote' and ${actionItems.entityId} = ${String(quoteId)}`,
    );
}

describe("RFQ intake Customer resolution", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  });

  afterAll(async () => {
    const quoteIds = [...new Set(createdQuoteIds)];
    if (quoteIds.length > 0) {
      for (const quoteId of quoteIds) {
        const id = String(quoteId);
        await db.execute(sql`delete from action_items where entity_type = 'quote' and entity_id = ${id}`);
        await db.execute(sql`delete from event_logs where entity_type = 'quote' and entity_id = ${id}`);
        await db.execute(sql`delete from notes where entity_type = 'quote' and entity_id = ${id}`);
        await db.execute(sql`delete from quote_attachments where quote_id = ${quoteId}`);
        await db.execute(sql`delete from quote_line_items where quote_id = ${quoteId}`);
        await db.execute(sql`delete from quote_parts where quote_id = ${quoteId}`);
      }
      await db.execute(sql`delete from rfq_import_ledger where quote_id in ${quoteIds}`);
    }
    for (const receiptNumber of receiptNumbers) {
      await db.execute(sql`delete from attachments where s3_key like ${`rfq-intake-archives/${receiptNumber}%`}`);
      await db.execute(sql`delete from rfq_import_ledger where receipt_number = ${receiptNumber}`);
    }
    if (quoteIds.length > 0) {
      await db.delete(quotes).where(inArray(quotes.id, quoteIds));
    }
    const orgIds = [...new Set(createdOrganizationIds)];
    if (orgIds.length > 0) {
      await db.execute(sql`delete from orders where customer_account_id in (select id from accounts where organization_id in ${orgIds})`);
      await deleteTestOrganizations(orgIds);
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  it.each([
    ["trailing whitespace and uppercase", (e: string) => `  ${e.toUpperCase()} `],
    ["a mailto prefix", (e: string) => `mailto:${e}`],
    ["an angle-bracket wrapper", (e: string) => `Jane Smith <${e}>`],
    ["a stray trailing period", (e: string) => `${e}.`],
  ])("attaches to the existing Customer when the email differs by %s", async (label, vary) => {
    const existingEmail = emailFor(`variant-${label.replace(/\W+/g, "-")}`);
    const existing = await seedCustomer({ email: existingEmail });

    const { customerId } = await submitRfq({ email: vary(existingEmail) });

    expect(customerId).toBe(existing.id);
    expect(await customersWithEmail(existingEmail)).toHaveLength(1);
  });

  it("attaches to the Customer holding the email as an alias", async () => {
    const aliasEmail = emailFor("alias-hit");
    const holder = await seedCustomer({
      email: emailFor("alias-holder-primary"),
      aliases: [aliasEmail],
    });

    const { customerId } = await submitRfq({ email: aliasEmail });

    expect(customerId).toBe(holder.id);
  });

  it("never attaches to an archived Customer and creates a fresh one instead", async () => {
    const email = emailFor("archived");
    const archived = await seedCustomer({
      email,
      aliases: [email],
      isArchived: true,
    });

    const { customerId } = await submitRfq({ email });

    expect(customerId).not.toBe(archived.id);
    const fresh = await loadAccountRecord("customer", customerId);
    expect(fresh).toMatchObject({ email, isArchived: false });
  });

  it("creates a business Organization, its Contact and a customer account when nothing matches", async () => {
    const email = emailFor("brand-new");

    const { customerId } = await submitRfq({
      email: `  ${email.toUpperCase()}.`,
      firstName: "Grace",
      lastName: "Hopper",
      company: "Navy Yard",
      phone: "5550100",
    });

    const created = await loadAccountRecord("customer", customerId);
    expect(created).toMatchObject({
      kind: "business",
      displayName: "Navy Yard",
      companyName: "Navy Yard",
      contactName: "Grace Hopper",
      email,
      phone: "+15550100",
    });
    const aliases = await db
      .select({ email: contactEmailAliases.email })
      .from(contactEmailAliases)
      .where(eq(contactEmailAliases.contactId, created!.primaryContactId!));
    expect(aliases).toEqual([{ email }]);
  });

  it("creates an individual Organization when the form gave no company", async () => {
    const email = emailFor("individual-new");
    const { customerId } = await submitRfq({ email, firstName: "Ada", lastName: "Lovelace", company: null });
    expect(await loadAccountRecord("customer", customerId)).toMatchObject({
      kind: "individual",
      displayName: "Ada Lovelace",
      companyName: null,
      contactName: "Ada Lovelace",
    });
  });

  it("fills only the blank name and phone of the matched Contact and never changes the Organization", async () => {
    const email = emailFor("single-fill");
    const existing = await seedCustomer({
      email,
      name: "Existing Person",
      kind: "individual",
      contactName: "Existing Contact",
      phone: null,
    });

    const { customerId } = await submitRfq({
      email,
      firstName: "New",
      lastName: "Person",
      company: "Acme Corp",
      phone: "5550199",
    });

    expect(customerId).toBe(existing.id);
    const after = await loadAccountRecord("customer", existing.id);
    expect(after).toMatchObject({
      kind: "individual",
      displayName: "Existing Person",
      contactName: "Existing Contact",
      phone: "+15550199",
    });
  });

  it("does not overwrite fields staff already filled in", async () => {
    const email = emailFor("single-keep");
    const existing = await seedCustomer({
      email,
      name: "Original Co",
      kind: "business",
      contactName: "Original Contact",
      phone: "+15550000",
    });

    await submitRfq({
      email,
      firstName: "New",
      lastName: "Person",
      company: "Other Co",
      phone: "5550199",
    });

    const after = await loadAccountRecord("customer", existing.id);
    expect(after).toMatchObject({
      companyName: "Original Co",
      contactName: "Original Contact",
      phone: "+15550000",
    });
  });

  describe("when several active Customers match", () => {
    it("attaches to the most recently active one, creates no Customer, and raises one review item", async () => {
      const email = emailFor("multi-recent");
      const quiet = await seedCustomer({ email });
      const withOldQuote = await seedCustomer({ email });
      const withRecentOrder = await seedCustomer({ email });
      await seedQuoteFor(withOldQuote.id, new Date("2026-01-01T00:00:00Z"));
      await seedOrderFor(withRecentOrder.id, new Date("2026-08-01T00:00:00Z"));

      const { quoteId, customerId } = await submitRfq({ email });

      expect(customerId).toBe(withRecentOrder.id);
      expect(await customersWithEmail(email)).toHaveLength(3);
      const items = await reviewItemsFor(quoteId);
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe("active");
      expect(items[0].metadata).toMatchObject({
        quoteId,
        candidateCustomerIds: [quiet.id, withOldQuote.id, withRecentOrder.id].sort(),
        attachedCustomerId: withRecentOrder.id,
      });
      expect(items[0].title).toContain("Review Customer match");
    });

    it("breaks an activity tie by choosing the oldest Customer", async () => {
      const email = emailFor("multi-tie");
      const older = await seedCustomer({ email });
      const newer = await seedCustomer({ email });
      const sameMoment = new Date("2026-06-01T00:00:00Z");
      await seedQuoteFor(older.id, sameMoment);
      await seedOrderFor(newer.id, sameMoment);

      const { customerId } = await submitRfq({ email });

      expect(customerId).toBe(older.id);
    });

    it("counts a match through an alias and ignores archived duplicates", async () => {
      const email = emailFor("multi-alias");
      const byPrimary = await seedCustomer({ email });
      const byAlias = await seedCustomer({
        email: emailFor("multi-alias-other"),
        aliases: [email],
      });
      await seedCustomer({ email, aliases: [email], isArchived: true });
      await seedQuoteFor(byAlias.id, new Date("2026-07-01T00:00:00Z"));

      const { quoteId, customerId } = await submitRfq({ email });

      expect(customerId).toBe(byAlias.id);
      const [item] = await reviewItemsFor(quoteId);
      expect(item.metadata).toMatchObject({
        candidateCustomerIds: [byPrimary.id, byAlias.id].sort(),
      });
    });
  });

  it("attaches an RFQ from a merged-away Customer's email to the survivor", async () => {
    const survivorEmail = emailFor("merged-survivor");
    const mergedEmail = emailFor("merged-away");
    const survivor = await seedCustomer({ email: survivorEmail });
    const mergedAway = await seedCustomer({ email: mergedEmail });
    await db.insert(users).values({
      id: mergeActorId,
      email: `${mergeActorId}@example.invalid`,
      role: "Admin",
    }).onConflictDoNothing();
    createdUserIds.push(mergeActorId);

    await mergeOrganizations(
      { survivorId: survivor.organizationId, mergedId: mergedAway.organizationId },
      mergeActor,
    );
    const { customerId, quoteId } = await submitRfq({ email: mergedEmail });

    // The merged-away person is now a Contact of the survivor.
    expect(customerId).toBe(survivor.id);
    expect(await reviewItemsFor(quoteId)).toHaveLength(0);
    expect((await loadAccountRecord("customer", mergedAway.id))?.isArchived).toBe(true);
    const contacts = await listOrganizationContacts(survivor.organizationId);
    expect(contacts.map((contact) => contact.email).sort()).toEqual([mergedEmail, survivorEmail].sort());
  });

  it("raises a review when one Contact belongs to two customer Organizations", async () => {
    const email = emailFor("shared-contact");
    const first = await seedCustomer({ email, name: `First ${tag}`, kind: "business" });
    const second = await seedCustomer({ email: null, name: `Second ${tag}`, kind: "business" });
    await db.insert(organizationContacts).values({
      organizationId: second.organizationId,
      contactId: first.primaryContactId!,
      isPrimary: true,
    });
    await seedQuoteFor(second.id, new Date("2026-05-01T00:00:00Z"));

    const { quoteId, customerId } = await submitRfq({ email });

    expect(customerId).toBe(second.id);
    const [item] = await reviewItemsFor(quoteId);
    expect(item.metadata).toMatchObject({ candidateCustomerIds: [first.id, second.id].sort() });
  });

  it("adds a customer account to a Vendor's Organization when its Contact sends an RFQ", async () => {
    const email = emailFor("vendor-buys");
    const vendor = await createTestVendor({ name: `Shop ${tag}`, kind: "business", contactName: "Sam", email });
    createdOrganizationIds.push(vendor.organizationId);

    const { customerId } = await submitRfq({ email });

    const customer = await loadAccountRecord("customer", customerId);
    expect(customer?.organizationId).toBe(vendor.organizationId);
    expect(customer?.contactName).toBe("Sam");
  });

  it("raises no review item when exactly one Customer matches", async () => {
    const email = emailFor("single-no-review");
    await seedCustomer({ email });

    const { quoteId } = await submitRfq({ email });

    expect(await reviewItemsFor(quoteId)).toHaveLength(0);
  });
});
