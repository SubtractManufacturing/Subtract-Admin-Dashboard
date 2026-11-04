/**
 * The sync against real Postgres and the real quote paths, with Twenty faked.
 * Requires DATABASE_URL pointing at a migrated Postgres instance.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { FakeTwenty } from "~/test/fake-twenty";
import { mergeCustomers } from "../customer-merge.server";
import { db } from "../db";
import { customers, quotes, sentEmails, twentySyncLinks, users } from "../db/schema";
import { createQuote, updateQuote } from "../quotes";
import wordpressManifest from "../rfq-intake/fixtures/wordpress-manifest.json";
import { createRfqImporter } from "../rfq-intake/importer";
import { createPostgresRfqPersistence } from "../rfq-intake/postgres.server";
import { MemoryStorage } from "../rfq-intake/test-support/memory-storage";
import {
  clearTwentyRetryDelay,
  createdAtOrAfter,
  getTwentySyncOverview,
  getTwentyCompanyChoice,
  postgresTwentySyncStore as store,
  saveTwentyCompanyChoice,
  withTwentySyncLock,
} from "./store.server";
import { companyIdentityFor, companyKeyFor } from "./matching";
import { runTwentySync } from "./sync.server";

const tag = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}-${tag}@example.invalid`;
const FAR_FUTURE = new Date("2099-01-01T00:00:00.000Z");
const actorId = `twenty-sync-actor-${tag}`;

const persistence = createPostgresRfqPersistence({
  attachmentBucket: "integration-test",
});

let syncStartedAt: Date;
let twenty: FakeTwenty;
const customerIds: number[] = [];
const quoteIds: number[] = [];
const emailIds: number[] = [];

const sweep = (now = new Date()) =>
  runTwentySync({ store, twenty, syncStartedAt, now: () => now, limit: 200 });

const due = (now = new Date()) => store.listDue({ now, syncStartedAt, limit: 500 });

const isDue = async (entityType: "customer" | "quote", entityId: number) =>
  (await due()).some(
    (row) => row.entityType === entityType && row.entityId === entityId,
  );

async function seedCustomer(values: Partial<typeof customers.$inferInsert> = {}) {
  const [customer] = await db
    .insert(customers)
    .values({
      displayName: `Acme ${tag}`,
      companyName: `Acme ${tag}`,
      contactName: "Bob Jones",
      email: emailFor(randomUUID().slice(0, 6)),
      ...values,
    })
    .returning();
  customerIds.push(customer.id);
  return customer;
}

async function manualQuote(customerId: number) {
  const quote = await createQuote({ customerId, status: "RFQ" });
  if (!quote) throw new Error("createQuote failed");
  quoteIds.push(quote.id);
  return quote;
}

/** One WordPress submission through the real importer. */
async function rfqQuote(email: string) {
  const receiptNumber = `TEST-TWENTY-${randomUUID()}`;
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
      first_name: "Jane",
      last_name: "Smith",
      company: `Widget Works ${tag}`,
      email,
      phone: "5551234567",
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
    now: () => new Date(),
  });
  const outcome = await importer.importReceipt(receiptKey);
  if (outcome.status !== "completed") {
    throw new Error(`Import did not complete: ${JSON.stringify(outcome)}`);
  }
  quoteIds.push(outcome.quoteId);
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, outcome.quoteId));
  customerIds.push(quote.customerId);
  return quote;
}

const opportunityFor = (quoteNumber: string) =>
  twenty.opportunities.find((item) => item.name.startsWith(`${quoteNumber} `));

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await db.insert(users).values({ id: actorId, email: emailFor("actor"), role: "Admin" });
});

beforeEach(() => {
  syncStartedAt = new Date(Date.now() - 1000);
  twenty = new FakeTwenty();
});

afterAll(async () => {
  if (emailIds.length > 0) {
    await db.delete(sentEmails).where(inArray(sentEmails.id, emailIds));
  }
  for (const [entityType, ids] of [
    ["quote", quoteIds],
    ["customer", customerIds],
  ] as const) {
    if (ids.length === 0) continue;
    await db
      .delete(twentySyncLinks)
      .where(
        and(
          eq(twentySyncLinks.entityType, entityType),
          inArray(twentySyncLinks.entityId, ids),
        ),
      );
  }
  // Archived rather than deleted: RFQ quotes own many child rows.
  if (quoteIds.length > 0) {
    await db.update(quotes).set({ isArchived: true }).where(inArray(quotes.id, quoteIds));
  }
  if (customerIds.length > 0) {
    await db
      .update(customers)
      .set({ isArchived: true })
      .where(inArray(customers.id, customerIds));
  }
});

describe("both quote creation paths", () => {
  it("gives a manual quote and an RFQ quote one opportunity each", async () => {
    const customer = await seedCustomer();
    const manual = await manualQuote(customer.id);
    const rfq = await rfqQuote(emailFor("jane"));

    await sweep();

    const manualLink = await store.getLink("quote", manual.id);
    const rfqLink = await store.getLink("quote", rfq.id);
    expect(manualLink?.syncState).toBe("synced");
    expect(rfqLink?.syncState).toBe("synced");
    expect(manualLink?.twentyOpportunityId).toBe(opportunityFor(manual.quoteNumber)?.id);
    expect(rfqLink?.twentyOpportunityId).toBe(opportunityFor(rfq.quoteNumber)?.id);
    expect(opportunityFor(manual.quoteNumber)?.fields.rfqStatus).toBe("NEW_RFQ");
    expect(opportunityFor(rfq.quoteNumber)?.fields.rfqStatus).toBe("NEW_RFQ");

    const person = twenty.people.find(
      (item) => item.emails?.primaryEmail === emailFor("jane"),
    );
    expect(person).toMatchObject({
      name: { firstName: "Jane", lastName: "Smith" },
      phones: { primaryPhoneNumber: "5551234567", primaryPhoneCallingCode: "+1" },
    });
  });

  it("does not see an unchanged row as due again", async () => {
    // defaultNow() keeps microseconds that a JS Date cannot hold.
    const customer = await seedCustomer();
    const quote = await manualQuote(customer.id);
    await sweep();

    expect(await isDue("customer", customer.id)).toBe(false);
    expect(await isDue("quote", quote.id)).toBe(false);

    // Filtered: other integration files may add unrelated due rows in parallel.
    const writesForQuote = () =>
      twenty.writes.filter(
        (write) => write.id === opportunityFor(quote.quoteNumber)?.id,
      ).length;
    const writes = writesForQuote();
    await sweep();
    expect(writesForQuote()).toBe(writes);
    expect(
      twenty.opportunities.filter((item) => item.name.startsWith(`${quote.quoteNumber} `)),
    ).toHaveLength(1);
  });

  it("leaves quotes created before the enable date alone", async () => {
    const customer = await seedCustomer();
    const quote = await manualQuote(customer.id);
    syncStartedAt = FAR_FUTURE;

    expect(await isDue("quote", quote.id)).toBe(false);
  });
});

describe("later changes", () => {
  it("picks up a status change made through updateQuote", async () => {
    const customer = await seedCustomer();
    const quote = await manualQuote(customer.id);
    await sweep();

    await updateQuote(quote.id, { status: "Rejected", rejectionReason: "Price" });
    expect(await isDue("quote", quote.id)).toBe(true);
    await sweep();

    expect(opportunityFor(quote.quoteNumber)?.fields.rfqStatus).toBe("LOST");
    expect((await store.getLink("quote", quote.id))?.syncedQuoteStatus).toBe("Rejected");
  });

  it("repoints a quote when its customer is merged away", async () => {
    const survivor = await seedCustomer({
      companyName: `Survivor ${tag}`,
      displayName: `Survivor ${tag}`,
    });
    const merged = await seedCustomer({
      companyName: `Merged ${tag}`,
      displayName: `Merged ${tag}`,
    });
    const quote = await manualQuote(merged.id);
    await sweep();

    await mergeCustomers(
      { survivorId: survivor.id, mergedId: merged.id },
      { userId: actorId, email: emailFor("actor"), role: "Admin" },
    );

    expect(await isDue("quote", quote.id)).toBe(true);
    await sweep();

    const survivorLink = await store.getLink("customer", survivor.id);
    expect(opportunityFor(quote.quoteNumber)?.fields.companyId).toBe(
      survivorLink?.twentyCompanyId,
    );
  });
});

describe("enable-date comparison", () => {
  it.each(["America/Los_Angeles", "Asia/Tokyo", "UTC"])(
    "gives the same answer in a %s session",
    async (timezone) => {
      const before = new Date(Date.now() - 60_000);
      const after = new Date(Date.now() + 60_000);

      const [inside, outside] = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('timezone', ${timezone}, true)`);
        // The column default runs in this session, as a manual quote's would.
        const [customer] = await tx
          .insert(customers)
          .values({ displayName: `TZ ${tag}` })
          .returning({ id: customers.id });
        customerIds.push(customer.id);

        const matches = (instant: Date) =>
          tx
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.id, customer.id),
                createdAtOrAfter(customers.createdAt, instant),
              ),
            );
        return [await matches(before), await matches(after)];
      });

      expect(inside).toHaveLength(1);
      expect(outside).toHaveLength(0);
    },
  );

  it("handles a value written by the app, as RFQ imports do", async () => {
    const instant = new Date(Date.now() - 3_600_000);
    const customer = await seedCustomer({ createdAt: instant });

    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, customer.id),
          createdAtOrAfter(customers.createdAt, instant),
        ),
      );
    const later = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, customer.id),
          createdAtOrAfter(customers.createdAt, new Date(instant.getTime() + 1000)),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(later).toHaveLength(0);
  });
});

describe("priced quote delivery", () => {
  async function addEmail(quoteId: number, contextKey: string, status: "pending_approval" | "sent") {
    const [email] = await db
      .insert(sentEmails)
      .values({
        quoteId,
        contextKey,
        entityType: "quote",
        entityId: String(quoteId),
        idempotencyKey: randomUUID(),
        fromEmail: emailFor("from"),
        subject: "Quote",
        toAddresses: [emailFor("to")],
        htmlBody: "<p>Quote</p>",
        source: "user",
        status,
        updatedAt: new Date(),
      })
      .returning({ id: sentEmails.id });
    emailIds.push(email.id);
    return email.id;
  }

  it("sets QUOTE_SENT only once an approved send is delivered", async () => {
    const customer = await seedCustomer();
    const quote = await manualQuote(customer.id);
    await updateQuote(quote.id, { status: "Draft" });
    await sweep();
    expect(opportunityFor(quote.quoteNumber)?.fields.rfqStatus).toBe("QUOTING");

    const emailId = await addEmail(quote.id, "quote_send", "pending_approval");
    await db
      .update(quotes)
      .set({ status: "Sent", updatedAt: new Date() })
      .where(eq(quotes.id, quote.id));
    await sweep();
    expect(opportunityFor(quote.quoteNumber)?.fields.rfqStatus).toBe("QUOTING");
    expect(await isDue("quote", quote.id)).toBe(false);

    // Delivery updates only the email row, exactly as the worker does.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db
      .update(sentEmails)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(sentEmails.id, emailId));

    expect(await isDue("quote", quote.id)).toBe(true);
    await sweep();
    expect(opportunityFor(quote.quoteNumber)?.fields.rfqStatus).toBe("QUOTE_SENT");
  });

  it("ignores an RFQ acknowledgment email", async () => {
    const customer = await seedCustomer();
    const quote = await manualQuote(customer.id);
    await sweep();

    await addEmail(quote.id, "quote_auto_created", "sent");

    expect(await isDue("quote", quote.id)).toBe(false);
    expect((await store.getQuote(quote.id))?.lastSendStatus).toBeNull();
    expect(opportunityFor(quote.quoteNumber)?.fields.rfqStatus).toBe("NEW_RFQ");
  });
});

describe("shared lock", () => {
  it("turns away a second sync while one is running", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const first = withTwentySyncLock(async () => {
      entered();
      await held;
      return "first";
    });
    await inside;

    await expect(withTwentySyncLock(async () => "second")).resolves.toEqual({ ran: false });

    release();
    await expect(first).resolves.toEqual({ ran: true, value: "first" });
    await expect(withTwentySyncLock(async () => "third")).resolves.toEqual({
      ran: true,
      value: "third",
    });
  });
});

describe("choosing a company", () => {
  it("keeps the choice through a real sync", async () => {
    const customer = await seedCustomer({
      companyName: `Twin ${tag}`,
      displayName: `Twin ${tag}`,
      email: `twin-${tag}@gmail.com`,
    });
    const quote = await manualQuote(customer.id);
    twenty.companies.push(
      { id: "one", name: `Twin ${tag}`, domain: null },
      { id: "two", name: `TWIN ${tag} LLC`, domain: null },
    );

    await sweep();
    const pending = await getTwentyCompanyChoice(customer.id);
    expect(pending?.candidates.map((item) => item.id)).toEqual(["one", "two"]);
    expect((await getTwentySyncOverview(syncStartedAt)).failures.some((item) => item.companyChoice)).toBe(true);

    await saveTwentyCompanyChoice(
      customer.id,
      "two",
      companyKeyFor(companyIdentityFor(customer)),
    );
    await sweep();

    expect(await store.getLink("customer", customer.id)).toMatchObject({
      syncState: "synced",
      twentyCompanyId: "two",
    });
    expect(opportunityFor(quote.quoteNumber)?.fields.companyId).toBe("two");
  });
});

describe("correcting a company", () => {
  it("moves an already synced opportunity to the chosen company", async () => {
    const customer = await seedCustomer({
      companyName: `Wrong ${tag}`,
      displayName: `Wrong ${tag}`,
      email: `wrong-${tag}@gmail.com`,
    });
    const quote = await manualQuote(customer.id);
    await sweep();
    expect(await isDue("quote", quote.id)).toBe(false);

    twenty.companies.push({ id: "right", name: `Right ${tag}`, domain: null });
    await saveTwentyCompanyChoice(
      customer.id,
      "right",
      companyKeyFor(companyIdentityFor(customer)),
    );

    expect(await isDue("quote", quote.id)).toBe(true);
    await sweep();
    expect(opportunityFor(quote.quoteNumber)?.fields.companyId).toBe("right");
  });
});

describe("phone warnings", () => {
  it("lists a customer whose phone could not sync", async () => {
    const customer = await seedCustomer({ phone: "ask for Bob" });

    await sweep();

    const { warnings } = await getTwentySyncOverview(syncStartedAt);
    expect(warnings).toContainEqual({
      customerId: customer.id,
      customerName: customer.displayName,
      warning: expect.stringContaining("ask for Bob"),
    });
  });
});

describe("failures", () => {
  it("backs off, shows the failure, and clears after a retry", async () => {
    const customer = await seedCustomer();
    const quote = await manualQuote(customer.id);
    twenty.down = true;

    const outage = await sweep();
    expect(outage.stoppedEarly).toBe(true);

    const { failures } = await getTwentySyncOverview(syncStartedAt);
    const failure = failures.find((item) => item.lastError?.includes("Could not reach"));
    if (!failure) throw new Error("Expected a visible failure");
    expect(failure.attemptCount).toBe(1);
    expect(failure.nextAttemptAt).not.toBeNull();
    expect(await isDue(failure.entityType, failure.entityId)).toBe(false);

    twenty.down = false;
    await clearTwentyRetryDelay(failure);
    await sweep();

    expect((await store.getLink("quote", quote.id))?.syncState).toBe("synced");
    const remaining = (await getTwentySyncOverview(syncStartedAt)).failures;
    expect(
      remaining.some(
        (item) =>
          item.entityType === failure.entityType && item.entityId === failure.entityId,
      ),
    ).toBe(false);
  });
});
