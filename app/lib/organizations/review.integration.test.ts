/**
 * The review list (ADR-0014 "Tests that hold the rule" > Review).
 *
 * Requires DATABASE_URL pointing at a disposable database synced with
 * `db:push`. Every assertion is scoped to the rows this file seeds, so it runs
 * beside the other integration tests.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { archiveCustomer, updateCustomer } from "../customers";
import { client, db } from "../db";
import { cutoverReviewMarks, eventLogs } from "../db/schema";
import { getEnv } from "../env.server";
import { updateVendor } from "../vendors";
import { createCutoverFixture } from "~/test/cutover-fixtures";
import { FREE_EMAIL_DOMAINS } from "./free-email-domains";
import {
  BUSINESS_WORDS,
  REVIEW_FLAGS,
  mapLegacyNames,
  reviewFlags,
} from "./mapping";
import { recordShadowStage } from "./stage.server";
import {
  clearReview,
  loadReviewRows,
  reviewProgress,
  ReviewError,
  saveReview,
} from "./review.server";

const fixture = createCutoverFixture("review");
const { tag, actor } = fixture;

const PRECHECK_SQL = path.resolve(__dirname, "../../../scripts/sql/organizations-precheck.sql");

type PrecheckRow = {
  kind: "customer" | "vendor";
  id: number;
  display_name: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  becomes_type: "business" | "individual";
  becomes_organization: string | null;
  becomes_contact: string | null;
  flags: string[];
};

async function rowJson(table: "customers" | "vendors", id: number) {
  const [row] = await db.execute<{ row: Record<string, unknown> }>(
    sql`select to_jsonb(t) as row from ${sql.identifier(table)} t where t.id = ${id}`,
  );
  return row.row;
}

async function eventsFor(entityType: "customer" | "vendor", id: number) {
  return db
    .select()
    .from(eventLogs)
    .where(and(eq(eventLogs.entityType, entityType), eq(eventLogs.entityId, String(id))));
}

async function listed(type: "customer" | "vendor", id: number) {
  return (await loadReviewRows()).find((row) => row.type === type && row.id === id);
}

const seenOf = (row: { displayName: string; companyName: string | null; contactName: string | null }) => ({
  displayName: row.displayName,
  companyName: row.companyName,
  contactName: row.contactName,
});

beforeAll(async () => {
  if (!getEnv("DATABASE_URL")) {
    throw new Error("DATABASE_URL is not set; point it at a disposable database.");
  }
  await fixture.seedUser();
  // A review saves in Shadow only. Recording Shadow is what every start of
  // this release does, and it changes nothing when the stage is Shadow already.
  await recordShadowStage();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("the precheck query and the review list", () => {
  it("repeats the mapping module's lists", async () => {
    const text = await readFile(PRECHECK_SQL, "utf8");
    const domains = [...text.matchAll(/'([a-z0-9.-]+\.[a-z.]+)'/g)].map((match) => match[1]);
    expect(domains.sort()).toEqual([...FREE_EMAIL_DOMAINS].sort());
    const words = /\\m\(([a-z|]+)\)\\M/.exec(text)?.[1].split("|");
    expect(words).toEqual([...BUSINESS_WORDS]);
  });

  it("flag the same rows and show the same result", async () => {
    const email = `pat-${tag}@gmail.com`;
    const business = `pat-${tag}@example-robotics.invalid`;
    const cases: Array<{ displayName: string; companyName?: string | null; contactName?: string | null; email?: string | null }> = [
      { displayName: `Plain Person ${tag}`, email },
      { displayName: `Example Co ${tag} - Pat Example`, email },
      { displayName: `Example Co ${tag} – Pat Example`, email },
      { displayName: `Example Co ${tag} / Pat Example`, email },
      { displayName: `Example Co ${tag} (Pat Example)`, email },
      { displayName: `Pat Example c/o Example Co ${tag}`, email },
      { displayName: `Pat Example AT Example Co ${tag}`, email },
      { displayName: `Pat Example @ Example Co ${tag}`, email },
      { displayName: `Example Machining ${tag}`, email },
      { displayName: `Example, INC. ${tag}`, email },
      { displayName: `Vincent Toolan ${tag}`, email },
      { displayName: `Caféinc ${tag}`, email },
      { displayName: `Example_tech ${tag}`, email },
      { displayName: `Pat ${tag}`, email: business },
      { displayName: `Pat ${tag}`, email: ` Pat-${tag}@Example-Robotics.INVALID ` },
      { displayName: `Pat ${tag}`, email: `PAT-${tag}@YAHOO.CO.UK` },
      { displayName: `Example Tools ${tag} - Pat`, email: business },
      { displayName: `Pat ${tag}`, companyName: `Example Co ${tag}`, email },
      { displayName: "", companyName: `Example Co ${tag}`, email },
      { displayName: ` Example Co ${tag} `, companyName: `Example Co ${tag}`, email },
      { displayName: `X ${tag}`, companyName: `Example Co ${tag}`, contactName: `EXAMPLE CO ${tag}`, email },
      { displayName: `Pat ${tag}`, companyName: `Example Co ${tag}`, contactName: "Pat Example", email },
      { displayName: `Pat ${tag}` },
      { displayName: `Pat ${tag}`, email: "   " },
      { displayName: `Pat ${tag}`, email: "no at sign" },
      { displayName: `Pat ${tag}`, email: "pat@" },
      { displayName: `Pat ${tag}`, email: "a@b@c" },
      // Blank means the same in SQL and in the browser, whatever the whitespace.
      { displayName: `Pat ${tag}`, companyName: "", contactName: "", email },
      { displayName: `Pat ${tag}`, companyName: "   ", contactName: " \t", email },
      { displayName: `Pat ${tag}`, companyName: "\n", contactName: " ", email },
      { displayName: `Pat ${tag}`, companyName: " 　", contactName: "﻿", email: `\t${email}\n` },
      { displayName: " \t ", email },
      { displayName: "", email },
      { displayName: "  ", contactName: `Pat ${tag}`, email },
      { displayName: `\tExample Co ${tag}\n`, companyName: `Example Co ${tag}`, email },
    ];
    const seeded: Array<{ type: "customer" | "vendor"; id: number }> = [];
    for (const [index, values] of cases.entries()) {
      // Alternate, so Vendors get every rule too.
      if (index % 3 === 2) seeded.push({ type: "vendor", id: (await fixture.seedVendor(values)).id });
      else seeded.push({ type: "customer", id: (await fixture.seedCustomer(values)).id });
    }
    const archivedCustomer = await fixture.seedCustomer({ displayName: `Archived Tools ${tag}`, isArchived: true });
    const archivedVendor = await fixture.seedVendor({ displayName: `Archived Tools ${tag}`, isArchived: true });

    // The file itself, unchanged.
    const precheck = (await client.unsafe(await readFile(PRECHECK_SQL, "utf8"))) as unknown as PrecheckRow[];
    const precheckByKey = new Map(precheck.map((row) => [`${row.kind}:${row.id}`, row]));
    const listedRows = await loadReviewRows();
    const listedByKey = new Map(listedRows.map((row) => [`${row.type}:${row.id}`, row]));

    const seenFlags = new Set<string>();
    for (const { type, id } of seeded) {
      const key = `${type}:${id}`;
      const fromSql = precheckByKey.get(key);
      const fromList = listedByKey.get(key);
      expect(fromSql, `${key} is in the precheck`).toBeDefined();
      expect(fromList, `${key} is on the review list`).toBeDefined();
      if (!fromSql || !fromList) continue;

      const names = mapLegacyNames(fromList);
      const context = JSON.stringify(seenOf(fromList));
      expect(names.kind, context).toBe(fromSql.becomes_type);
      expect(names.organizationName, context).toBe(fromSql.becomes_organization);
      expect(names.contactName, context).toBe(fromSql.becomes_contact);
      const flags = reviewFlags(fromList);
      expect(flags.map((flag) => REVIEW_FLAGS[flag]), context).toEqual(fromSql.flags);
      for (const flag of flags) seenFlags.add(flag);
    }
    // The cases above exercise every flag, and at least one row with none.
    expect([...seenFlags].sort()).toEqual(Object.keys(REVIEW_FLAGS).sort());
    expect(seeded.some(({ type, id }) => precheckByKey.get(`${type}:${id}`)?.flags.length === 0)).toBe(true);

    // Both leave archived rows out.
    for (const key of [`customer:${archivedCustomer.id}`, `vendor:${archivedVendor.id}`]) {
      expect(precheckByKey.has(key)).toBe(false);
      expect(listedByKey.has(key)).toBe(false);
    }
  });
});

describe("saving a review", () => {
  it("changes only the fields the reviewer edited, through the Customer update, with its Event log", async () => {
    const customer = await fixture.seedCustomer({
      displayName: `Example Co ${tag} - Pat Example`,
      email: `save-${tag}@example.invalid`,
      phone: "555-0100",
      paymentTerms: "Net 30",
      billingAddressLine1: "1 Main St",
    });
    const before = await rowJson("customers", customer.id);
    const eventsBefore = await eventsFor("customer", customer.id);

    const result = await saveReview(
      {
        type: "customer",
        id: customer.id,
        seen: seenOf(customer),
        changes: { companyName: ` Example Co ${tag} `, contactName: "Pat Example" },
      },
      actor,
    );
    expect(result.changedFields.sort()).toEqual(["companyName", "contactName"]);

    const after = await rowJson("customers", customer.id);
    expect(after).toEqual({
      ...before,
      company_name: `Example Co ${tag}`,
      contact_name: "Pat Example",
      updated_at: after.updated_at,
    });
    expect(after.updated_at).not.toBe(before.updated_at);

    const events = await eventsFor("customer", customer.id);
    expect(events).toHaveLength(eventsBefore.length + 1);
    const event = events.find((row) => !eventsBefore.some((old) => old.id === row.id));
    expect(event).toMatchObject({
      eventType: "customer_updated",
      userId: actor.userId,
      userEmail: actor.email,
      metadata: { companyName: `Example Co ${tag}`, contactName: "Pat Example" },
    });

    expect(await listed("customer", customer.id)).toMatchObject({
      reviewed: true,
      companyName: `Example Co ${tag}`,
      contactName: "Pat Example",
    });
  });

  it("clears company and contact, and renames", async () => {
    const customer = await fixture.seedCustomer({
      displayName: `Wrong ${tag}`,
      companyName: `Not A Company ${tag}`,
      contactName: "Nobody",
    });
    const result = await saveReview(
      {
        type: "customer",
        id: customer.id,
        seen: seenOf(customer),
        changes: { displayName: `  Right ${tag} `, companyName: "", contactName: null },
      },
      actor,
    );
    expect(result.changedFields.sort()).toEqual(["companyName", "contactName", "displayName"]);
    expect(await rowJson("customers", customer.id)).toMatchObject({
      display_name: `Right ${tag}`,
      company_name: null,
      contact_name: null,
    });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: true });
  });

  it("marks a row as right without touching it", async () => {
    const customer = await fixture.seedCustomer({ displayName: `Fine ${tag}`, companyName: "  " });
    const before = await rowJson("customers", customer.id);
    const eventsBefore = await eventsFor("customer", customer.id);

    // No edits, and "clearing" a field that is already blank, are both no change.
    for (const changes of [{}, { companyName: "", contactName: "" }, { displayName: `Fine ${tag}` }]) {
      const result = await saveReview(
        { type: "customer", id: customer.id, seen: seenOf(customer), changes },
        actor,
      );
      expect(result.changedFields).toEqual([]);
    }
    expect(await rowJson("customers", customer.id)).toEqual(before);
    expect(await eventsFor("customer", customer.id)).toHaveLength(eventsBefore.length);
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: true, reviewedAt: expect.any(Date) });
  });

  it("saves a Vendor through the Vendor update", async () => {
    const vendor = await fixture.seedVendor({
      displayName: `Example Machining ${tag}`,
      discordId: "1234",
      notes: "Good at titanium",
    });
    const before = await rowJson("vendors", vendor.id);

    const result = await saveReview(
      { type: "vendor", id: vendor.id, seen: seenOf(vendor), changes: { companyName: `Example Machining ${tag}` } },
      actor,
    );
    expect(result.changedFields).toEqual(["companyName"]);
    const after = await rowJson("vendors", vendor.id);
    expect(after).toEqual({ ...before, company_name: `Example Machining ${tag}`, updated_at: after.updated_at });
    expect(await eventsFor("vendor", vendor.id)).toEqual([
      expect.objectContaining({
        eventType: "vendor_updated",
        userId: actor.userId,
        metadata: { companyName: `Example Machining ${tag}` },
      }),
    ]);
    expect(await listed("vendor", vendor.id)).toMatchObject({ reviewed: true });
  });

  it("refuses a save against a row that changed, is archived, or would lose its name", async () => {
    const customer = await fixture.seedCustomer({ displayName: `Stale ${tag}` });
    await updateCustomer(customer.id, { companyName: `Set Meanwhile ${tag}` });
    const stale = await saveReview(
      { type: "customer", id: customer.id, seen: seenOf(customer), changes: { contactName: "Pat" } },
      actor,
    ).catch((error: unknown) => error);
    expect(stale).toBeInstanceOf(ReviewError);
    expect(stale).toMatchObject({ status: 409 });
    expect(await rowJson("customers", customer.id)).toMatchObject({ contact_name: null });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: false });

    const current = { ...seenOf(customer), companyName: `Set Meanwhile ${tag}` };
    await expect(
      saveReview({ type: "customer", id: customer.id, seen: current, changes: { displayName: "   " } }, actor),
    ).rejects.toMatchObject({ status: 400 });

    await archiveCustomer(customer.id);
    await expect(
      saveReview({ type: "customer", id: customer.id, seen: current, changes: {} }, actor),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      saveReview({ type: "vendor", id: 2_000_000_000, seen: current, changes: {} }, actor),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("the reviewed mark", () => {
  it("resets when the row's result changes and stays when an unrelated field changes", async () => {
    const customer = await fixture.seedCustomer({
      displayName: `Mark ${tag}`,
      companyName: `Mark Co ${tag}`,
      contactName: "Pat Example",
      email: `mark-${tag}@example.invalid`,
    });
    const vendor = await fixture.seedVendor({ displayName: `Mark Shop ${tag}` });
    await saveReview({ type: "customer", id: customer.id, seen: seenOf(customer), changes: {} }, actor);
    await saveReview({ type: "vendor", id: vendor.id, seen: seenOf(vendor), changes: {} }, actor);
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: true });

    // Unrelated fields: the result (type, Organization name, Contact name) is the same.
    await updateCustomer(customer.id, {
      email: `other-${tag}@example.invalid`,
      phone: "555-0199",
      paymentTerms: "Net 45",
      billingAddressLine1: "9 Other St",
      // The display name is not part of the result while company and contact are set.
      displayName: `Renamed ${tag}`,
    });
    await updateVendor(vendor.id, { discordId: "42", notes: "A note", email: `shop-${tag}@example.invalid` });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: true });
    expect(await listed("vendor", vendor.id)).toMatchObject({ reviewed: true });

    // Each of the three result parts resets the mark.
    await updateCustomer(customer.id, { contactName: "Someone Else" });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: false, reviewedAt: null });
    await updateCustomer(customer.id, { contactName: "Pat Example" });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: true });
    await updateCustomer(customer.id, { companyName: `Mark Company ${tag}` });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: false });
    await updateCustomer(customer.id, { companyName: null });
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: false });
    await updateVendor(vendor.id, { displayName: `Mark Machine Shop ${tag}` });
    expect(await listed("vendor", vendor.id)).toMatchObject({ reviewed: false });

    // Reviewing again counts for the new result.
    const current = (await listed("customer", customer.id))!;
    await saveReview({ type: "customer", id: customer.id, seen: seenOf(current), changes: {} }, actor);
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: true });
    const marks = await db
      .select()
      .from(cutoverReviewMarks)
      .where(and(eq(cutoverReviewMarks.legacyType, "customer"), eq(cutoverReviewMarks.legacyId, customer.id)));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      reviewedBy: actor.userId,
      resultFingerprint: JSON.stringify(["individual", `Renamed ${tag}`, "Pat Example"]),
    });
  });

  it("can be taken back, and leaves the list when the row is archived", async () => {
    const customer = await fixture.seedCustomer({ displayName: `Undo ${tag}` });
    await saveReview({ type: "customer", id: customer.id, seen: seenOf(customer), changes: {} }, actor);
    const before = await rowJson("customers", customer.id);
    await clearReview("customer", customer.id);
    expect(await listed("customer", customer.id)).toMatchObject({ reviewed: false });
    expect(await rowJson("customers", customer.id)).toEqual(before);

    await archiveCustomer(customer.id);
    expect(await listed("customer", customer.id)).toBeUndefined();
  });

  it("counts progress over the rows it is given", async () => {
    const rows = (await loadReviewRows()).filter((row) =>
      row.type === "customer" ? fixture.customerIds.includes(row.id) : fixture.vendorIds.includes(row.id),
    );
    const progress = reviewProgress(rows);
    expect(progress.total).toBe(rows.length);
    expect(progress.reviewed).toBe(rows.filter((row) => row.reviewed).length);
    expect(progress.reviewed).toBeGreaterThan(0);
    expect(progress.flagged).toBe(rows.filter((row) => reviewFlags(row).length > 0).length);
    expect(progress.flaggedUnreviewed).toBeLessThanOrEqual(progress.flagged);
    expect(progress.flaggedUnreviewed).toBeGreaterThan(0);
  });
});
