/**
 * Intake Customer resolution through the importer's import seam.
 * Requires DATABASE_URL pointing at a migrated Postgres instance.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  actionItems,
  customerEmailAliases,
  customers,
  orders,
  quotes,
  users,
} from "../db/schema";
import { mergeCustomers } from "../customer-merge.server";
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
const createdCustomerIds: number[] = [];
const createdUserIds: string[] = [];
const receiptNumbers: string[] = [];
const mergeActorId = `intake-merge-actor-${tag}`;

type Contact = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string | null;
  phone?: string | null;
};

async function seedCustomer(input: {
  email: string | null;
  aliases?: string[];
  displayName?: string;
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  isArchived?: boolean;
}) {
  const [customer] = await db
    .insert(customers)
    .values({
      displayName: input.displayName ?? `Seed ${randomUUID().slice(0, 6)}`,
      email: input.email,
      companyName: input.companyName ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      isArchived: input.isArchived ?? false,
    })
    .returning();
  createdCustomerIds.push(customer.id);
  const aliasEmails = input.aliases ?? [];
  if (aliasEmails.length > 0) {
    await db.insert(customerEmailAliases).values(
      aliasEmails.map((email) => ({ customerId: customer.id, email })),
    );
  }
  return customer;
}

async function seedQuoteFor(customerId: number, createdAt: Date) {
  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber: `T${randomUUID().slice(0, 10)}`,
      customerId,
      status: "RFQ",
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: quotes.id });
  createdQuoteIds.push(quote.id);
  return quote.id;
}

async function seedOrderFor(customerId: number, createdAt: Date) {
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `T${randomUUID().slice(0, 10)}`,
      customerId,
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
    .select({ id: quotes.id, customerId: quotes.customerId })
    .from(quotes)
    .where(eq(quotes.id, outcome.quoteId));
  return { quoteId: quote.id, customerId: quote.customerId };
}

async function customersWithEmail(email: string) {
  return db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(sql`lower(trim(${customers.email}))`, email));
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
    const customerIds = [...new Set(createdCustomerIds)];
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
    if (customerIds.length > 0) {
      await db.execute(sql`delete from event_logs where entity_type = 'customer' and entity_id in ${customerIds.map(String)}`);
      await db.execute(sql`delete from orders where customer_id in ${customerIds}`);
      await db.execute(sql`delete from customer_email_aliases where customer_id in ${customerIds}`);
      await db.update(customers).set({ mergedIntoCustomerId: null }).where(inArray(customers.id, customerIds));
      await db.delete(customers).where(inArray(customers.id, customerIds));
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
    createdCustomerIds.push(customerId);

    expect(customerId).not.toBe(archived.id);
    const [fresh] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(fresh).toMatchObject({ email, isArchived: false });
  });

  it("creates a new Customer with its email as an alias when nothing matches", async () => {
    const email = emailFor("brand-new");

    const { customerId } = await submitRfq({
      email: `  ${email.toUpperCase()}.`,
      firstName: "Grace",
      lastName: "Hopper",
      company: "Navy Yard",
      phone: "5550100",
    });
    createdCustomerIds.push(customerId);

    const [created] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(created).toMatchObject({
      displayName: "Navy Yard - Grace Hopper",
      companyName: "Navy Yard",
      contactName: "Grace Hopper",
      email,
      phone: "+15550100",
    });
    const aliases = await db
      .select({ email: customerEmailAliases.email })
      .from(customerEmailAliases)
      .where(eq(customerEmailAliases.customerId, customerId));
    expect(aliases).toEqual([{ email }]);
  });

  it("fills only the blank company, contact name and phone of a single match", async () => {
    const email = emailFor("single-fill");
    const existing = await seedCustomer({
      email,
      companyName: null,
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
    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, existing.id));
    expect(after).toMatchObject({
      companyName: "Acme Corp",
      contactName: "Existing Contact",
      phone: "+15550199",
    });
  });

  it("does not overwrite fields staff already filled in", async () => {
    const email = emailFor("single-keep");
    const existing = await seedCustomer({
      email,
      companyName: "Original Co",
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

    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, existing.id));
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
        candidateCustomerIds: [quiet.id, withOldQuote.id, withRecentOrder.id],
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
        candidateCustomerIds: [byPrimary.id, byAlias.id],
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
    });
    createdUserIds.push(mergeActorId);

    await mergeCustomers(
      { survivorId: survivor.id, mergedId: mergedAway.id },
      { userId: mergeActorId, email: `${mergeActorId}@example.invalid`, role: "Admin" },
    );
    const { customerId } = await submitRfq({ email: mergedEmail });

    expect(customerId).toBe(survivor.id);
    expect(
      (await db.select({ isArchived: customers.isArchived }).from(customers).where(eq(customers.id, mergedAway.id)))[0]
        .isArchived,
    ).toBe(true);
  });

  it("raises no review item when exactly one Customer matches", async () => {
    const email = emailFor("single-no-review");
    await seedCustomer({ email });

    const { quoteId } = await submitRfq({ email });

    expect(await reviewItemsFor(quoteId)).toHaveLength(0);
  });
});
