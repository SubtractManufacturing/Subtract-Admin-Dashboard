import { beforeEach, describe, expect, it } from "vitest";

import type { TwentySyncLink } from "../db/schema";
import { FakeTwenty } from "~/test/fake-twenty";
import { TwentyApiError } from "./client.server";
import { companyIdentityFor, companyKeyFor } from "./matching";
import {
  retryDelayMinutes,
  runTwentySync,
  syncOneQuote,
  type DueRecord,
  type SyncCustomer,
  type SyncEntityType,
  type SyncQuote,
  type TwentySyncStore,
} from "./sync.server";

const START = new Date("2026-11-01T00:00:00.000Z");
const T1 = new Date("2026-11-03T10:00:00.000Z");
const T2 = new Date("2026-11-03T11:00:00.000Z");

/** In-memory store mirroring the Postgres store's selection and version rules. */
class FakeStore implements TwentySyncStore {
  customers = new Map<number, SyncCustomer>();
  quotes = new Map<number, SyncQuote & { createdAt: Date }>();
  links = new Map<string, TwentySyncLink>();
  crashOnQuoteLinkSave = false;
  archived = new Set<number>();

  private key(type: SyncEntityType, id: number) {
    return `${type}:${id}`;
  }
  link(type: SyncEntityType, id: number) {
    return this.links.get(this.key(type, id));
  }
  private merge(type: SyncEntityType, id: number, values: Partial<TwentySyncLink>) {
    const existing = this.link(type, id);
    this.links.set(this.key(type, id), {
      entityType: type,
      entityId: id,
      twentyPersonId: null,
      twentyCompanyId: null,
      twentyOpportunityId: null,
      syncedSourceUpdatedAt: null,
      syncedCompanyKey: null,
      syncedQuoteStatus: null,
      syncedAmountMicros: null,
      failureDetail: null,
      syncWarning: null,
      syncState: null,
      lastError: null,
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: T1,
      updatedAt: T1,
      ...existing,
      ...values,
    });
  }

  async listDue({ now, syncStartedAt, limit }: { now: Date; syncStartedAt: Date; limit: number }) {
    const due: Array<DueRecord & { lastAttempt: number }> = [];
    const consider = (type: SyncEntityType, id: number, updatedAt: Date, createdAt: Date) => {
      const link = this.link(type, id);
      if (createdAt < syncStartedAt && !link) return;
      if (link?.syncedSourceUpdatedAt && updatedAt <= link.syncedSourceUpdatedAt) return;
      if (link?.nextAttemptAt && link.nextAttemptAt > now) return;
      due.push({
        entityType: type,
        entityId: id,
        lastAttempt: link?.lastAttemptAt?.getTime() ?? 0,
      });
    };
    for (const customer of this.customers.values()) {
      consider("customer", customer.id, customer.updatedAt, customer.updatedAt);
    }
    for (const quote of this.quotes.values()) {
      consider("quote", quote.id, quote.updatedAt, quote.createdAt);
    }
    return due
      .sort((a, b) => a.lastAttempt - b.lastAttempt)
      .slice(0, limit)
      .map(({ entityType, entityId }) => ({ entityType, entityId }));
  }
  async getCustomer(id: number) {
    return this.customers.get(id) ?? null;
  }
  async getQuote(id: number) {
    return this.quotes.get(id) ?? null;
  }
  async findQuoteByNumber(quoteNumber: string) {
    const quote = [...this.quotes.values()].find((item) => item.quoteNumber === quoteNumber);
    return quote ? { id: quote.id, isArchived: this.archived.has(quote.id) } : null;
  }
  async getLink(type: SyncEntityType, id: number) {
    return this.link(type, id) ?? null;
  }
  private synced(now: Date) {
    return {
      syncState: "synced" as const,
      lastError: null,
      attemptCount: 0,
      lastAttemptAt: now,
      nextAttemptAt: null,
      failureDetail: null,
    };
  }
  async saveCustomerLink(
    id: number,
    values: Partial<TwentySyncLink>,
    now: Date,
    { invalidateQuotes }: { invalidateQuotes: boolean },
  ) {
    this.merge("customer", id, { ...values, ...this.synced(now) });
    if (!invalidateQuotes) return;
    for (const quote of this.quotes.values()) {
      if (quote.customerId !== id || !this.link("quote", quote.id)) continue;
      this.merge("quote", quote.id, { syncedSourceUpdatedAt: null });
    }
  }
  chooseCompany(customerId: number, companyId: string) {
    const customer = this.customers.get(customerId) as SyncCustomer;
    this.merge("customer", customerId, {
      twentyCompanyId: companyId,
      syncedCompanyKey: companyKeyFor(companyIdentityFor(customer)),
      syncedSourceUpdatedAt: null,
    });
    for (const link of this.links.values()) {
      if (link.failureDetail?.customerId !== customerId) continue;
      this.merge(link.entityType, link.entityId, { nextAttemptAt: null, failureDetail: null });
    }
  }
  async saveQuoteLink(id: number, values: Partial<TwentySyncLink>, now: Date) {
    if (this.crashOnQuoteLinkSave) {
      this.crashOnQuoteLinkSave = false;
      throw new Error("worker crashed before the link was saved");
    }
    this.merge("quote", id, { ...values, ...this.synced(now) });
  }
  async markFailed(
    record: DueRecord,
    error: string,
    now: Date,
    detail: TwentySyncLink["failureDetail"] = null,
  ) {
    const attemptCount = (this.link(record.entityType, record.entityId)?.attemptCount ?? 0) + 1;
    this.merge(record.entityType, record.entityId, {
      syncState: "failed",
      lastError: error,
      failureDetail: detail,
      attemptCount,
      lastAttemptAt: now,
      nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(attemptCount) * 60_000),
    });
  }
}

let store: FakeStore;
let twenty: FakeTwenty;
let clock: Date;

const run = (limit?: number) =>
  runTwentySync({ store, twenty, syncStartedAt: START, now: () => clock, limit });

function addCustomer(id: number, values: Partial<SyncCustomer> = {}) {
  const customer: SyncCustomer = {
    id,
    displayName: "Acme",
    companyName: "Acme",
    contactName: "Bob Jones",
    title: null,
    email: "bob@acme.com",
    phone: null,
    updatedAt: T1,
    ...values,
  };
  store.customers.set(id, customer);
  return customer;
}

function addQuote(id: number, customerId: number, values: Partial<SyncQuote & { createdAt: Date }> = {}) {
  const quote = {
    id,
    quoteNumber: `Q2611-00${id}`,
    customerId,
    status: "RFQ",
    total: "0.00",
    updatedAt: T1,
    createdAt: T1,
    sentAt: null,
    lastSendStatus: null,
    lastSendUpdatedAt: null,
    ...values,
  };
  store.quotes.set(id, quote);
  return quote;
}

beforeEach(() => {
  store = new FakeStore();
  twenty = new FakeTwenty();
  clock = T1;
});

describe("opportunity creation", () => {
  it("creates company, person and one opportunity for a new quote", async () => {
    addCustomer(1);
    addQuote(10, 1);

    await expect(run()).resolves.toMatchObject({ synced: 2, failed: 0 });

    expect(twenty.writesOf("createCompany")).toHaveLength(1);
    expect(twenty.writesOf("createPerson")).toHaveLength(1);
    const [opportunity] = twenty.opportunities;
    expect(opportunity.fields).toMatchObject({
      name: "Q2611-0010 - Acme",
      rfqStatus: "NEW_RFQ",
      companyId: twenty.companies[0].id,
      pointOfContactId: twenty.people[0].id,
    });
    expect(opportunity.fields).not.toHaveProperty("closeDate");
    expect(opportunity.fields).not.toHaveProperty("amount");
    expect(store.link("quote", 10)?.twentyOpportunityId).toBe(opportunity.id);
  });

  it("treats a manual quote and an RFQ quote the same, whatever email did", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft", total: "250.00" });
    addQuote(11, 1, { status: "RFQ", quoteNumber: "Q2611-011" });

    await run();

    expect(twenty.opportunities).toHaveLength(2);
    expect(twenty.opportunities[0].fields).toMatchObject({
      rfqStatus: "QUOTING",
      amount: { amountMicros: 250_000_000, currencyCode: "USD" },
    });
    expect(twenty.opportunities[1].fields.rfqStatus).toBe("NEW_RFQ");
  });

  it("leaves quotes from before the enable date for the backfill", async () => {
    addCustomer(1);
    addQuote(10, 1, { createdAt: new Date("2026-10-01T00:00:00.000Z") });

    await run();

    expect(twenty.opportunities).toHaveLength(0);
  });
});

describe("repeat processing", () => {
  it("does nothing when nothing changed", async () => {
    addCustomer(1);
    addQuote(10, 1);
    await run();
    const writes = twenty.writes.length;

    await expect(run()).resolves.toMatchObject({ synced: 0, failed: 0 });

    expect(twenty.writes).toHaveLength(writes);
    expect(twenty.opportunities).toHaveLength(1);
  });

  it("finds its opportunity by ERP ID when saving the link failed", async () => {
    addCustomer(1);
    addQuote(10, 1);
    store.crashOnQuoteLinkSave = true;

    await run();
    expect(store.link("quote", 10)?.syncState).toBe("failed");
    expect(twenty.opportunities).toHaveLength(1);
    // Staff renaming it must not break recovery, unlike matching on the name.
    twenty.opportunities[0].name = "Renamed by sales";

    clock = T2;
    await run();

    expect(twenty.opportunities).toHaveLength(1);
    expect(twenty.writesOf("createOpportunity")).toHaveLength(1);
    expect(store.link("quote", 10)?.twentyOpportunityId).toBe(twenty.opportunities[0].id);
    expect(twenty.opportunities[0].fields.erpQuoteId).toBe("10");
  });

  it("finds its opportunity when Twenty kept a create but the response was lost", async () => {
    addCustomer(1);
    addQuote(10, 1);
    twenty.loseNextCreateResponse = true;

    await run();
    expect(store.link("quote", 10)?.twentyOpportunityId).toBeNull();

    clock = T2;
    await run();

    expect(twenty.opportunities).toHaveLength(1);
    expect(store.link("quote", 10)?.twentyOpportunityId).toBe(twenty.opportunities[0].id);
  });

  it("adopts the winner when another run creates the opportunity first", async () => {
    addCustomer(1);
    addQuote(10, 1);
    const find = twenty.findOpportunitiesByErpQuoteId.bind(twenty);
    let firstLookup = true;
    twenty.findOpportunitiesByErpQuoteId = async (id) => {
      if (firstLookup) {
        firstLookup = false;
        return [];
      }
      return find(id);
    };
    twenty.opportunities.push({
      id: "winner",
      name: "Q2611-0010 - Acme",
      fields: { erpQuoteId: "10" },
    });

    await run();

    expect(twenty.opportunities).toHaveLength(1);
    expect(store.link("quote", 10)?.twentyOpportunityId).toBe("winner");
  });

  it("reports duplicates rather than picking one", async () => {
    addCustomer(1);
    addQuote(10, 1);
    twenty.opportunities.push(
      { id: "a", name: "x", fields: { erpQuoteId: "10" } },
      { id: "b", name: "y", fields: { erpQuoteId: "10" } },
    );

    await run();

    expect(store.link("quote", 10)?.lastError).toContain("Several Twenty opportunities");
  });

  it("stores the version it read, so an edit during the push is not lost", async () => {
    addCustomer(1);
    addQuote(10, 1, { total: "100.00" });
    const original = store.saveQuoteLink.bind(store);
    store.saveQuoteLink = async (id, values, now) => {
      await original(id, values, now);
      addQuote(10, 1, { total: "200.00", updatedAt: T2 });
    };

    clock = T2;
    await run();
    expect(store.link("quote", 10)?.syncedSourceUpdatedAt).toEqual(T1);

    store.saveQuoteLink = original;
    await run();

    expect(twenty.opportunities[0].fields.amount).toMatchObject({
      amountMicros: 200_000_000,
    });
  });
});

describe("status updates", () => {
  async function syncAs(status: string, at: Date) {
    const quote = store.quotes.get(10) as SyncQuote;
    addQuote(10, quote.customerId, { ...quote, status, updatedAt: at });
    clock = at;
    await run();
  }

  it("keeps a staff rfqStatus until the ERP status changes", async () => {
    addCustomer(1);
    addQuote(10, 1);
    await run();
    twenty.opportunities[0].fields.rfqStatus = "REVIEWING";

    addQuote(10, 1, { total: "500.00", updatedAt: T2 });
    clock = T2;
    await run();

    const [update] = twenty.writesOf("updateOpportunity");
    expect(update.fields).not.toHaveProperty("rfqStatus");
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("REVIEWING");

    await syncAs("Sent", new Date(T2.getTime() + 60_000));
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTE_SENT");
  });

  it("moves back to QUOTING when a sent quote is revised", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Sent" });
    await run();

    await syncAs("Draft", T2);

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
  });

  it("maps accepted, rejected and dropped outcomes", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Sent" });
    await run();

    await syncAs("Accepted", T2);
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("WON");
    await syncAs("Rejected", new Date(T2.getTime() + 60_000));
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("LOST");
    await syncAs("Sent", new Date(T2.getTime() + 120_000));
    await syncAs("Dropped", new Date(T2.getTime() + 180_000));
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("LOST");
  });

  it("leaves rfqStatus alone when a quote expires", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Sent" });
    await run();
    twenty.opportunities[0].fields.rfqStatus = "FOLLOW_UP";

    await syncAs("Expired", T2);

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("FOLLOW_UP");
  });
});

describe("priced quote delivery", () => {
  const later = (minutes: number) => new Date(T1.getTime() + minutes * 60_000);

  async function update(values: Partial<SyncQuote>) {
    addQuote(10, 1, { ...store.quotes.get(10), ...values });
    clock = values.updatedAt ?? clock;
    await run();
  }

  it("waits for approval and delivery before QUOTE_SENT", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");

    await update({ status: "Sent", lastSendStatus: "pending_approval", updatedAt: later(1) });
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");

    await update({ lastSendStatus: "queued", updatedAt: later(2) });
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");

    await update({ lastSendStatus: "sent", updatedAt: later(3) });
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTE_SENT");
  });

  it.each(["failed", "bounced", "sending"])("does not count a %s send", async (lastSendStatus) => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();

    await update({ status: "Sent", lastSendStatus, updatedAt: later(1) });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
  });

  it("does not disturb a staff status while the send is pending", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();
    twenty.opportunities[0].fields.rfqStatus = "REVIEWING";

    await update({ status: "Sent", lastSendStatus: "pending_approval", updatedAt: later(1) });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("REVIEWING");
  });

  it("creates a pending quote as QUOTING, not QUOTE_SENT", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Sent", lastSendStatus: "pending_approval" });

    await run();

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
  });

  it("accepts a quote staff marked sent by hand, with no email involved", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();

    await update({ status: "Sent", lastSendStatus: null, updatedAt: later(1) });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTE_SENT");
  });

  it("leaves a rejected approval on its restored status", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();
    await update({ status: "Sent", lastSendStatus: "pending_approval", updatedAt: later(1) });

    await update({ status: "Draft", lastSendStatus: "rejected", updatedAt: later(2) });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
    expect(twenty.writesOf("updateOpportunity").every((w) => !("rfqStatus" in w.fields))).toBe(true);
  });

  it("does not wait on a send for WON or LOST", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();

    await update({ status: "Accepted", lastSendStatus: "pending_approval", updatedAt: later(1) });
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("WON");

    await update({ status: "Rejected", updatedAt: later(2) });
    expect(twenty.opportunities[0].fields.rfqStatus).toBe("LOST");
  });
});

describe("email outcomes and staff decisions", () => {
  const later = (minutes: number) => new Date(T1.getTime() + minutes * 60_000);

  async function update(values: Partial<SyncQuote>) {
    addQuote(10, 1, { ...store.quotes.get(10), ...values });
    clock = values.updatedAt ?? clock;
    await run();
  }

  it.each(["failed", "bounced", "rejected"])(
    "honors staff marking a quote sent after a %s email",
    async (lastSendStatus) => {
      addCustomer(1);
      addQuote(10, 1, { status: "Draft" });
      await run();

      await update({
        status: "Sent",
        lastSendStatus,
        lastSendUpdatedAt: later(1),
        sentAt: later(2),
        updatedAt: later(2),
      });

      expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTE_SENT");
    },
  );

  it.each(["failed", "bounced"])("holds a quote whose approved send then %s", async (status) => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();

    await update({
      status: "Sent",
      lastSendStatus: status,
      sentAt: later(1),
      lastSendUpdatedAt: later(2),
      updatedAt: later(2),
    });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
  });

  it("is not fooled by a sweep between a rejection and the quote reverting", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();

    await update({
      status: "Sent",
      lastSendStatus: "rejected",
      sentAt: later(1),
      lastSendUpdatedAt: later(2),
      updatedAt: later(2),
    });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
  });

  it("does not treat an in-progress email as a staff decision", async () => {
    addCustomer(1);
    addQuote(10, 1, { status: "Draft" });
    await run();

    await update({
      status: "Sent",
      lastSendStatus: "pending_approval",
      lastSendUpdatedAt: later(1),
      sentAt: later(2),
      updatedAt: later(2),
    });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe("QUOTING");
  });
});

describe("corrections", () => {
  const later = (minutes: number) => new Date(T1.getTime() + minutes * 60_000);

  async function update(values: Partial<SyncQuote>) {
    addQuote(10, 1, { ...store.quotes.get(10), ...values });
    clock = values.updatedAt ?? clock;
    await run();
  }

  it("clears a synced amount when the total is corrected to zero", async () => {
    addCustomer(1);
    addQuote(10, 1, { total: "500.00" });
    await run();
    expect(store.link("quote", 10)?.syncedAmountMicros).toBe(500_000_000);

    await update({ total: "0.00", updatedAt: later(1) });

    expect(twenty.opportunities[0].fields.amount).toEqual({
      amountMicros: null,
      currencyCode: "USD",
    });
    expect(store.link("quote", 10)?.syncedAmountMicros).toBeNull();
  });

  it("does not clear an amount the ERP never sent", async () => {
    addCustomer(1);
    addQuote(10, 1);
    await run();
    twenty.opportunities[0].fields.amount = { amountMicros: 9, currencyCode: "USD" };

    await update({ status: "Draft", updatedAt: later(1) });

    expect(twenty.opportunities[0].fields.amount).toEqual({
      amountMicros: 9,
      currencyCode: "USD",
    });
  });

  it("clears an amount left on a recovered opportunity", async () => {
    addCustomer(1);
    addQuote(10, 1, { total: "500.00" });
    store.crashOnQuoteLinkSave = true;
    await run();

    await update({ total: "0.00", updatedAt: later(5) });

    expect(twenty.opportunities[0].fields.amount).toMatchObject({ amountMicros: null });
  });

  it.each([
    ["Accepted", "WON", "Draft", "QUOTING"],
    ["Rejected", "LOST", "Draft", "QUOTING"],
    ["Dropped", "LOST", "Draft", "QUOTING"],
    ["Rejected", "LOST", "RFQ", "NEW_RFQ"],
  ])("replaces %s (%s) when reopened to %s", async (closed, closedStatus, open, openStatus) => {
    addCustomer(1);
    addQuote(10, 1, { status: closed });
    await run();
    expect(twenty.opportunities[0].fields.rfqStatus).toBe(closedStatus);

    await update({ status: open, updatedAt: later(1) });

    expect(twenty.opportunities[0].fields.rfqStatus).toBe(openStatus);
  });
});

describe("syncOneQuote", () => {
  const single = (quoteNumber: string) =>
    syncOneQuote({ store, twenty, quoteNumber, now: () => clock });

  it("syncs a quote from before the enable date and reads it back", async () => {
    addCustomer(1, { phone: "555-123-4567" });
    addQuote(10, 1, {
      total: "1250.50",
      status: "Draft",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await single(" Q2611-0010 ");

    expect(result).toEqual({
      ok: true,
      report: {
        quoteNumber: "Q2611-0010",
        created: true,
        matchingOpportunities: 1,
        opportunityId: twenty.opportunities[0].id,
        opportunityName: "Q2611-0010 - Acme",
        amount: 1250.5,
        rfqStatus: "QUOTING",
        company: "Acme",
        contactName: "Bob Jones",
        contactEmail: "bob@acme.com",
        warning: null,
      },
    });
  });

  it("touches only the chosen quote", async () => {
    addCustomer(1);
    addQuote(10, 1);
    addQuote(11, 1, { quoteNumber: "Q2611-OTHER" });

    await single("Q2611-0010");

    expect(twenty.opportunities).toHaveLength(1);
  });

  it("creates nothing on a second run", async () => {
    addCustomer(1);
    addQuote(10, 1);
    await single("Q2611-0010");
    const creates = () =>
      twenty.writes.filter((write) => write.op.startsWith("create")).length;
    const before = creates();

    const repeat = await single("Q2611-0010");

    expect(repeat).toMatchObject({
      ok: true,
      report: { created: false, matchingOpportunities: 1 },
    });
    expect(creates()).toBe(before);
    expect(twenty.opportunities).toHaveLength(1);
    expect(twenty.people).toHaveLength(1);
    expect(twenty.companies).toHaveLength(1);
  });

  it("refuses unknown and archived quotes", async () => {
    addCustomer(1);
    addQuote(10, 1);
    store.archived.add(10);

    await expect(single("nope")).resolves.toMatchObject({ ok: false });
    await expect(single("Q2611-0010")).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("archived"),
    });
    expect(twenty.writes).toHaveLength(0);
  });

  it("still reports the error when recording the failure also fails", async () => {
    addCustomer(1);
    addQuote(10, 1);
    store.getLink = async () => {
      throw new Error("column does not exist");
    };
    store.markFailed = async () => {
      throw new Error("column does not exist");
    };

    await expect(single("Q2611-0010")).resolves.toEqual({
      ok: false,
      error: "Unexpected sync error; see the server log",
    });
  });

  it("does not fail the record when only the read-back fails", async () => {
    addCustomer(1);
    addQuote(10, 1);
    twenty.readOpportunity = async () => {
      throw new TwentyApiError("Could not reach Twenty", null, true);
    };

    const result = await single("Q2611-0010");

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("could not read the result back"),
    });
    expect(store.link("quote", 10)?.syncState).toBe("synced");
  });

  it("records a failure the admin can see", async () => {
    addCustomer(1);
    addQuote(10, 1);
    twenty.down = true;

    await expect(single("Q2611-0010")).resolves.toMatchObject({ ok: false });

    expect(store.link("quote", 10)?.syncState).toBe("failed");
  });
});

describe("linking imported records", () => {
  it("links an imported person and company without creating duplicates", async () => {
    twenty.companies.push({ id: "imported-co", name: "ACME, Inc.", domain: "acme.com" });
    twenty.people.push({
      id: "imported-person",
      name: { firstName: "Bob", lastName: "Jones" },
      emails: { primaryEmail: "bob@acme.com", additionalEmails: [] },
      companyId: "imported-co",
    });
    addCustomer(1);
    addQuote(10, 1);

    await run();

    expect(twenty.writesOf("createCompany")).toHaveLength(0);
    expect(twenty.writesOf("createPerson")).toHaveLength(0);
    expect(store.link("customer", 1)).toMatchObject({
      twentyPersonId: "imported-person",
      twentyCompanyId: "imported-co",
    });
    expect(twenty.opportunities[0].fields).toMatchObject({
      companyId: "imported-co",
      pointOfContactId: "imported-person",
    });
  });

  it("reconciles a blank company name against an imported domain account", async () => {
    twenty.companies.push({ id: "domain-co", name: "widgetco.com", domain: "widgetco.com" });
    addCustomer(1, {
      companyName: null,
      displayName: "Pat Lee",
      contactName: "Pat Lee",
      email: "pat@widgetco.com",
    });
    addQuote(10, 1);

    await run();

    expect(twenty.writesOf("createCompany")).toHaveLength(0);
    expect(twenty.opportunities[0].fields.companyId).toBe("domain-co");
  });

  it("never groups unrelated free-mail customers into a company", async () => {
    twenty.companies.push({ id: "gmail-co", name: "gmail.com", domain: "gmail.com" });
    addCustomer(1, {
      companyName: null,
      displayName: "Ann Hill",
      contactName: "Ann Hill",
      email: "ann@gmail.com",
    });
    addCustomer(2, {
      companyName: null,
      displayName: "Joe Ross",
      contactName: "Joe Ross",
      email: "joe@gmail.com",
    });
    addQuote(10, 1);
    addQuote(11, 2);

    await run();

    expect(twenty.writesOf("createCompany")).toHaveLength(0);
    for (const opportunity of twenty.opportunities) {
      expect(opportunity.fields).not.toHaveProperty("companyId");
    }
  });

  it("reports an ambiguous company rather than guessing, without blocking others", async () => {
    twenty.companies.push(
      { id: "a", name: "Acme", domain: null },
      { id: "b", name: "ACME LLC", domain: null },
    );
    addCustomer(1, { email: "bob@gmail.com" });
    addCustomer(2, { companyName: "Other Co", displayName: "Other Co", email: "x@other.com" });
    addQuote(10, 1);
    addQuote(11, 2);

    await run();

    expect(store.link("quote", 10)?.syncState).toBe("failed");
    const quote = store.link("quote", 10);
    expect(quote?.lastError).toBe("More than one Twenty company could be Acme. Choose the right one.");
    expect(quote?.lastError).not.toMatch(/merge/i);
    expect(quote?.failureDetail).toMatchObject({
      kind: "company_choice",
      customerId: 1,
      companyName: "Acme",
      candidates: [{ id: "a" }, { id: "b" }],
    });
    expect(store.link("quote", 11)?.syncState).toBe("synced");
    expect(twenty.opportunities).toHaveLength(1);
  });

  it("uses the company staff chose, without changing anything else in Twenty", async () => {
    twenty.companies.push(
      { id: "a", name: "Acme", domain: null },
      { id: "b", name: "ACME LLC", domain: null },
    );
    addCustomer(1, { email: "bob@gmail.com" });
    addQuote(10, 1);
    await run();

    store.chooseCompany(1, "b");
    await run();

    expect(store.link("quote", 10)).toMatchObject({ syncState: "synced", failureDetail: null });
    expect(twenty.opportunities[0].fields.companyId).toBe("b");
    expect(twenty.companies).toHaveLength(2);
    expect(twenty.writesOf("createCompany")).toHaveLength(0);
  });

  it("keeps the staff choice on later customer edits", async () => {
    twenty.companies.push(
      { id: "a", name: "Acme", domain: null },
      { id: "b", name: "ACME LLC", domain: null },
    );
    addCustomer(1, { email: "bob@gmail.com" });
    addQuote(10, 1);
    await run();
    store.chooseCompany(1, "b");
    await run();

    addCustomer(1, { email: "bob@gmail.com", phone: "555-123-4567", updatedAt: T2 });
    clock = T2;
    await run();

    expect(store.link("customer", 1)).toMatchObject({ syncState: "synced", twentyCompanyId: "b" });
  });
});

describe("one contact for two companies", () => {
  const mark = { contactName: "Mark Britz", email: "trimarkperformance@gmail.com" };

  beforeEach(() => {
    addCustomer(1, { ...mark, companyName: "Tri-Mark", displayName: "Tri-Mark" });
    addCustomer(2, {
      ...mark,
      companyName: null,
      displayName: "Britzman Enterprises",
    });
    addQuote(10, 1);
    addQuote(11, 2);
  });

  it("keeps one person and two companies, each from the quote's account", async () => {
    await run();

    expect(twenty.people).toHaveLength(1);
    expect(twenty.companies.map((company) => company.name)).toEqual([
      "Tri-Mark",
      "Britzman Enterprises",
    ]);
    const [triMark, britzman] = twenty.opportunities;
    expect(triMark.fields.companyId).toBe(twenty.companies[0].id);
    expect(britzman.fields.companyId).toBe(twenty.companies[1].id);
    expect(triMark.fields.pointOfContactId).toBe(twenty.people[0].id);
    expect(britzman.fields.pointOfContactId).toBe(twenty.people[0].id);
    expect(store.link("customer", 1)?.twentyPersonId).toBe(
      store.link("customer", 2)?.twentyPersonId,
    );
  });

  it("never moves Mark's primary company for Britzman work", async () => {
    await run();
    const primaryCompany = twenty.people[0].companyId;

    addCustomer(2, {
      ...mark,
      companyName: null,
      displayName: "Britzman Enterprises",
      phone: "555-123-4567",
      updatedAt: T2,
    });
    addQuote(12, 2, { updatedAt: T2, createdAt: T2 });
    clock = T2;
    await run();

    expect(twenty.people[0].companyId).toBe(primaryCompany);
    for (const write of twenty.writesOf("updatePerson")) {
      expect(write.fields).not.toHaveProperty("companyId");
    }
  });
});

describe("preserving Twenty data", () => {
  it("does not blank contact details the ERP lacks", async () => {
    twenty.people.push({
      id: "p",
      name: { firstName: "Bob", lastName: "Jones" },
      emails: { primaryEmail: "bob@acme.com", additionalEmails: ["old@acme.com"] },
      phones: { primaryPhoneNumber: "5550001111" },
      jobTitle: "Buyer",
    });
    addCustomer(1, { contactName: null, title: null, phone: null });

    await run();

    for (const write of twenty.writesOf("updatePerson")) {
      expect(Object.keys(write.fields)).toEqual(["companyId"]);
    }
    expect(twenty.people[0]).toMatchObject({
      jobTitle: "Buyer",
      phones: { primaryPhoneNumber: "5550001111" },
    });
  });

  it("keeps the old address and other numbers when the ERP changes them", async () => {
    twenty.people.push({
      id: "p",
      emails: { primaryEmail: "bob@acme.com", additionalEmails: ["x@acme.com"] },
      phones: { primaryPhoneNumber: "5550001111", additionalPhones: [{ number: "1" }] },
    });
    addCustomer(1, { phone: "555-222-3333" });
    await run();

    addCustomer(1, { phone: "555-222-3333", email: "new@acme.com", updatedAt: T2 });
    clock = T2;
    await run();

    expect(twenty.people[0].emails).toEqual({
      primaryEmail: "new@acme.com",
      additionalEmails: ["x@acme.com", "bob@acme.com"],
    });
    expect(twenty.people[0].phones).toMatchObject({
      primaryPhoneNumber: "5552223333",
      additionalPhones: [{ number: "1" }],
    });
  });

  it("does not clear a contact set by hand when the ERP has none", async () => {
    addCustomer(1, { contactName: null, email: null });
    addQuote(10, 1);
    await run();
    expect(twenty.opportunities[0].fields).not.toHaveProperty("pointOfContactId");
  });

  it("drops a phone Twenty refuses and keeps the contact", async () => {
    const createPerson = twenty.createPerson.bind(twenty);
    twenty.createPerson = async (fields) => {
      if (fields.phones) {
        throw new TwentyApiError("Twenty returned 400: Invalid phone number", 400, false);
      }
      return createPerson(fields);
    };
    addCustomer(1, { phone: "555-123-4567" });
    addQuote(10, 1);

    await run();

    expect(twenty.people).toHaveLength(1);
    expect(twenty.opportunities).toHaveLength(1);
  });
});

describe("phone warnings", () => {
  it("warns about a phone it cannot send, and still syncs the contact", async () => {
    addCustomer(1, { phone: "call the front desk" });
    addQuote(10, 1);

    await run();

    expect(store.link("customer", 1)?.syncWarning).toContain("call the front desk");
    expect(store.link("customer", 1)?.syncState).toBe("synced");
    expect(twenty.people).toHaveLength(1);
    expect(twenty.opportunities).toHaveLength(1);
  });

  it("warns when Twenty refuses a phone that looked valid", async () => {
    const createPerson = twenty.createPerson.bind(twenty);
    twenty.createPerson = async (fields) => {
      if (fields.phones) {
        throw new TwentyApiError("Twenty returned 400: Invalid phone number", 400, false);
      }
      return createPerson(fields);
    };
    addCustomer(1, { phone: "555-123-4567" });

    await run();

    expect(store.link("customer", 1)?.syncWarning).toContain("555-123-4567");
    expect(store.link("customer", 1)?.syncState).toBe("synced");
  });

  it("clears the warning once the phone is fixed", async () => {
    addCustomer(1, { phone: "12345" });
    await run();
    expect(store.link("customer", 1)?.syncWarning).not.toBeNull();

    addCustomer(1, { phone: "555-123-4567", updatedAt: T2 });
    clock = T2;
    await run();

    expect(store.link("customer", 1)?.syncWarning).toBeNull();
  });

  it.each([null, "", "   ", "(555) 123-4567 x22"])("does not warn about %j", async (phone) => {
    addCustomer(1, { phone });

    await run();

    expect(store.link("customer", 1)?.syncWarning).toBeNull();
  });

  it("shows the warning on a single-quote sync", async () => {
    addCustomer(1, { phone: "12345" });
    addQuote(10, 1);

    const result = await syncOneQuote({ store, twenty, quoteNumber: "Q2611-0010" });

    expect(result).toMatchObject({
      ok: true,
      report: { warning: expect.stringContaining("12345") },
    });
  });
});

describe("customer changes", () => {
  it("clears an ERP-supplied company when a quote moves to an individual", async () => {
    addCustomer(1);
    addCustomer(2, {
      companyName: null,
      displayName: "Ann Hill",
      contactName: "Ann Hill",
      email: "ann@gmail.com",
    });
    addQuote(10, 1);
    await run();
    expect(twenty.opportunities[0].fields.companyId).toBeTruthy();

    addQuote(10, 2, { updatedAt: T2 });
    clock = T2;
    await run();

    expect(twenty.opportunities[0].fields.companyId).toBeNull();
    expect(twenty.opportunities[0].fields.pointOfContactId).toBe(
      store.link("customer", 2)?.twentyPersonId,
    );
  });

  it("repoints open opportunities when the customer's company changes", async () => {
    addCustomer(1);
    addQuote(10, 1);
    await run();
    const firstCompany = twenty.opportunities[0].fields.companyId;

    addCustomer(1, { companyName: "New Name Co", displayName: "New Name Co", updatedAt: T2 });
    clock = T2;
    await run();
    await run();

    expect(twenty.opportunities[0].fields.companyId).not.toBe(firstCompany);
  });
});

describe("failures and outages", () => {
  it("records an outage, stops early and catches up afterwards", async () => {
    addCustomer(1);
    addQuote(10, 1);
    addQuote(11, 1);
    twenty.down = true;

    const outage = await run();

    expect(outage).toMatchObject({ failed: 1, stoppedEarly: true });
    expect(twenty.opportunities).toHaveLength(0);
    const failedLinks = [...store.links.values()].filter((l) => l.syncState === "failed");
    expect(failedLinks).toHaveLength(1);
    expect(failedLinks[0].lastError).toContain("Could not reach Twenty");

    twenty.down = false;
    clock = new Date(T1.getTime() + 2 * 60 * 60_000);
    await run();

    expect(twenty.opportunities).toHaveLength(2);
    expect([...store.links.values()].some((l) => l.syncState === "failed")).toBe(false);
  });

  it("backs failing records off so newer records still run", async () => {
    addCustomer(1, { email: "bob@gmail.com" });
    twenty.companies.push(
      { id: "a", name: "Acme", domain: null },
      { id: "b", name: "ACME LLC", domain: null },
    );
    addQuote(10, 1);
    await run(1);
    await run(1);
    const attempts = store.link("customer", 1)?.attemptCount ?? 0;

    addCustomer(2, { companyName: "Fresh Co", displayName: "Fresh Co", email: "f@fresh.com", updatedAt: T2 });
    addQuote(11, 2, { updatedAt: T2, createdAt: T2 });
    await run(2);

    expect(store.link("customer", 2)?.syncState).toBe("synced");
    expect(store.link("quote", 11)?.syncState).toBe("synced");
    expect(store.link("customer", 1)?.attemptCount).toBe(attempts);
  });

  it("does not leak an unexpected error's text into the failure message", async () => {
    addCustomer(1);
    twenty.listCompanies = async () => {
      throw new Error("internal detail");
    };

    await run();

    expect(store.link("customer", 1)?.lastError).toBe(
      "Unexpected sync error; see the server log",
    );
  });

  it("grows the retry delay and caps it", () => {
    expect([1, 2, 3, 4, 9].map(retryDelayMinutes)).toEqual([2, 5, 15, 60, 60]);
  });
});
