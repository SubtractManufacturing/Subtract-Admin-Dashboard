/**
 * Sync and Check (ADR-0014 "Tests that hold the rule").
 *
 * Sync works on every Customer and Vendor row, so this file runs through
 * vitest.serial.config.ts, after the other integration tests and alone:
 *   DATABASE_URL=postgres://... npm run test:serial
 * Requires a disposable database synced with `db:push`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteAttachment,
  unlinkAttachmentFromCustomer,
} from "../attachments";
import { mergeCustomers } from "../customer-merge.server";
import {
  archiveCustomer,
  createCustomer,
  deleteCustomer,
  updateCustomer,
} from "../customers";
import { db } from "../db";
import {
  accounts,
  addresses,
  attachments,
  contacts,
  customerEmailAliases,
  customers,
  eventLogs,
  organizationContacts,
  organizations,
  orders,
  parts,
  quotes,
  vendors,
  type Customer,
  type Vendor,
} from "../db/schema";
import { getEnv } from "../env.server";
import { updateVendor } from "../vendors";
import {
  createCutoverFixture,
  readCopy,
  snapshotNewData,
  snapshotOldData,
  snapshotPolymorphic,
} from "~/test/cutover-fixtures";
import { runCheck } from "./check.server";
import { toLegacyRow } from "./differences";
import { mapLegacyParty } from "./mapping";
import {
  getCutoverStage,
  recordShadowStage,
  setCutoverStage,
} from "./stage.server";
import { getLastSync, runSync, SyncError, SYNC_RAN_EVENT } from "./sync.server";

const fixture = createCutoverFixture("sync");
const { tag, actor } = fixture;

/** Old and new must be equal for the whole database: nothing else runs beside this file. */
async function expectNoDifferences() {
  const report = await runCheck();
  expect(report.differences).toEqual([]);
  expect(report.total).toBe(0);
}

async function aliasesOf(customerId: number) {
  const rows = await db
    .select({ email: customerEmailAliases.email })
    .from(customerEmailAliases)
    .where(eq(customerEmailAliases.customerId, customerId));
  return rows.map((row) => row.email);
}

/** The copy must be exactly what the mapping gives, read without going through Check. */
async function expectCopyMatchesMapping(type: "customer" | "vendor", id: number) {
  const [row] =
    type === "customer"
      ? await db.select().from(customers).where(eq(customers.id, id))
      : await db.select().from(vendors).where(eq(vendors.id, id));
  const mapped = mapLegacyParty(
    toLegacyRow(type, row as Customer | Vendor, type === "customer" ? await aliasesOf(id) : []),
  );
  const copy = await readCopy(type, id);
  expect(copy, `${type} ${id} has a copy`).not.toBeNull();
  if (!copy) return;

  expect(copy.organization).toMatchObject({
    ...mapped.organization,
    phone: null,
    website: null,
    legacyCustomerId: type === "customer" ? id : null,
    legacyVendorId: type === "vendor" ? id : null,
  });
  expect(copy.links).toHaveLength(1);
  expect(copy.links[0]).toMatchObject({ isPrimary: true, isArchived: false, role: null });
  expect(copy.contact).toMatchObject({ ...mapped.contact, mergedIntoContactId: null });
  expect(copy.aliases).toEqual(mapped.aliases);
  expect(copy.account).toMatchObject({
    ...mapped.account,
    organizationId: copy.organization.id,
    legacyCustomerId: type === "customer" ? id : null,
    legacyVendorId: type === "vendor" ? id : null,
  });
  if (mapped.billingAddress) expect(copy.billingAddress).toMatchObject(mapped.billingAddress);
  else expect(copy.account.billingAddressId).toBeNull();
  if (mapped.shippingAddress) expect(copy.shippingAddress).toMatchObject(mapped.shippingAddress);
  else expect(copy.shippingAddress).toBeNull();
  expect(copy.addresses).toHaveLength(
    (mapped.billingAddress ? 1 : 0) + (mapped.shippingAddress ? 1 : 0),
  );
}

/** Every uuid the copies of this file's rows have, to prove they never change. */
async function copyIds() {
  const ids: Record<string, { organization: string; account: string; contact: string | null }> = {};
  for (const [type, list] of [
    ["customer", fixture.customerIds],
    ["vendor", fixture.vendorIds],
  ] as const) {
    for (const id of list) {
      const copy = await readCopy(type, id);
      if (!copy) continue;
      ids[`${type}:${id}`] = {
        organization: copy.organization.id,
        account: copy.account.id,
        contact: copy.contact?.id ?? null,
      };
    }
  }
  return ids;
}

beforeAll(async () => {
  if (!getEnv("DATABASE_URL")) {
    throw new Error("DATABASE_URL is not set; point it at a disposable database.");
  }
  await fixture.seedUser();
  await recordShadowStage();
});

afterAll(async () => {
  await setCutoverStage("shadow", { actor: null, source: "release_start" });
  await fixture.cleanup();
});

describe("generated old rows", () => {
  const NAME_VALUES = ["set", "blank", "whitespace"] as const;
  const value = (kind: (typeof NAME_VALUES)[number], text: string) =>
    kind === "set" ? text : kind === "blank" ? "" : " \t ";

  it("Sync then Check gives 0 differences, every copy is what the mapping gives, and a second Sync changes nothing", async () => {
    let index = 0;
    for (const type of ["customer", "vendor"] as const) {
      for (const display of NAME_VALUES) {
        for (const company of NAME_VALUES) {
          for (const contact of NAME_VALUES) {
            index += 1;
            const base = {
              displayName: value(display, `Gen ${tag} D${index}`),
              // A blank column is stored as null or as an empty string, both happen.
              companyName: company === "blank" && index % 2 ? null : value(company, `Gen ${tag} Co${index}`),
              contactName: contact === "blank" && index % 2 ? null : value(contact, `Gen ${tag} P${index}`),
              title: index % 3 === 0 ? " Buyer " : null,
              email: [null, `gen${index}-${tag}@example.invalid`, `  <Gen${index}-${tag}@Example.INVALID>. `, "not an email"][index % 4],
              phone: index % 2 ? "555-0100" : "  ",
              paymentTerms: index % 2 ? "Net 30" : null,
              isArchived: index % 5 === 0,
              // Addresses: none, billing, shipping, both, and country only.
              ...(index % 5 === 1 ? { billingAddressLine1: "1 Main St", billingCity: "Springfield", billingState: "IL", billingPostalCode: "62701" } : {}),
              ...(index % 5 === 2 ? { shippingAddressLine1: "2 Dock Rd", shippingAddressLine2: "Bay 4", shippingCountry: "CA" } : {}),
              ...(index % 5 === 3 ? { billingPostalCode: "62701", shippingCity: "Shelbyville", billingCountry: null } : {}),
              ...(index % 5 === 4 ? { billingAddressLine1: "   ", shippingCountry: "MX" } : {}),
            };
            if (type === "customer") {
              await fixture.seedCustomer(
                base,
                index % 3 === 0 ? [`alias${index}-${tag}@example.invalid`, `gen${index}-${tag}@example.invalid`] : [],
              );
            } else {
              await fixture.seedVendor({
                ...base,
                discordId: index % 2 ? `discord-${index}` : null,
                address: index % 3 ? "Old free text address" : null,
                notes: index % 4 ? "Good at titanium" : null,
              });
            }
          }
        }
      }
    }
    // A merged Customer: archived, with a pointer to its survivor.
    const [survivorId, mergedId] = fixture.customerIds;
    await db
      .update(customers)
      .set({ isArchived: true, mergedIntoCustomerId: survivorId })
      .where(eq(customers.id, mergedId));

    const before = await runCheck();
    expect(before.byArea.find((row) => row.area === "missing")?.count).toBeGreaterThanOrEqual(54);

    const first = await runSync(actor);
    expect(first.passes).toBe(1);
    expect(first.applied).toBe(before.fixable);
    expect(first.notFixable).toBe(0);
    await expectNoDifferences();

    for (const id of fixture.customerIds) await expectCopyMatchesMapping("customer", id);
    for (const id of fixture.vendorIds) await expectCopyMatchesMapping("vendor", id);

    const merged = await readCopy("customer", mergedId);
    const survivor = await readCopy("customer", survivorId);
    expect(merged?.organization.mergedIntoOrganizationId).toBe(survivor?.organization.id);
    expect(merged?.organization.isArchived).toBe(true);

    const afterFirst = await snapshotNewData();
    const second = await runSync(actor);
    expect(second).toMatchObject({ applied: 0, passes: 0, notFixable: 0 });
    expect(await snapshotNewData()).toEqual(afterFirst);
    await expectNoDifferences();
  });
});

describe("Sync and the old tables", () => {
  it("changes no old row, and only the account ids on Quotes, Orders and Parts", async () => {
    const customer = await fixture.seedCustomer(
      {
        companyName: `Old Co ${tag}`,
        contactName: "Pat Example",
        email: `old-${tag}@example.invalid`,
        billingAddressLine1: "1 Main St",
        shippingAddressLine1: "2 Dock Rd",
      },
      [`old-alias-${tag}@example.invalid`],
    );
    const vendor = await fixture.seedVendor({ email: `shop-${tag}@example.invalid` });
    await fixture.seedQuote(customer.id, vendor.id);
    await fixture.seedOrder(customer.id, vendor.id);
    await fixture.seedOrder(null, null);
    await fixture.seedPart(customer.id);
    await fixture.seedPart(null);
    await fixture.seedAttachment({ customerIds: [customer.id], vendorIds: [vendor.id] });
    await fixture.seedCommunication(customer.id);

    const before = await snapshotOldData();
    const result = await runSync(actor);
    expect(result.applied).toBeGreaterThan(0);
    expect(await snapshotOldData()).toEqual(before);
    await expectNoDifferences();
  });

  it("points Quotes, Orders and Parts at the account of their Customer and Vendor", async () => {
    const customer = await fixture.seedCustomer();
    const vendor = await fixture.seedVendor();
    const quote = await fixture.seedQuote(customer.id, vendor.id);
    const order = await fixture.seedOrder(customer.id, null);
    const part = await fixture.seedPart(customer.id);
    await runSync(actor);

    const customerCopy = await readCopy("customer", customer.id);
    const vendorCopy = await readCopy("vendor", vendor.id);
    const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    const [orderRow] = await db.select().from(orders).where(eq(orders.id, order.id));
    const [partRow] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(quoteRow).toMatchObject({
      customerAccountId: customerCopy?.account.id,
      vendorAccountId: vendorCopy?.account.id,
      customerId: customer.id,
      vendorId: vendor.id,
    });
    expect(orderRow).toMatchObject({ customerAccountId: customerCopy?.account.id, vendorAccountId: null });
    expect(partRow.customerAccountId).toBe(customerCopy?.account.id);
  });

  it("leaves Notes, Event logs, Action Items and match review metadata alone", async () => {
    const customer = await fixture.seedCustomer();
    const other = await fixture.seedCustomer();
    const vendor = await fixture.seedVendor();
    const quote = await fixture.seedQuote(customer.id);
    const note = await fixture.seedNote("customer", customer.id);
    const event = await fixture.seedEvent("vendor", vendor.id);
    const review = await fixture.seedMatchReview(quote.id, [customer.id, other.id]);
    const onCustomer = await fixture.seedCustomerActionItem(customer.id);

    const before = await snapshotPolymorphic(SYNC_RAN_EVENT);
    const syncEventsBefore = await db
      .select({ id: eventLogs.id })
      .from(eventLogs)
      .where(eq(eventLogs.eventType, SYNC_RAN_EVENT));
    const result = await runSync(actor);
    expect(result.applied).toBeGreaterThan(0);

    expect(await snapshotPolymorphic(SYNC_RAN_EVENT)).toEqual(before);
    // The ids are still the old integers, not account uuids.
    const after = await snapshotPolymorphic();
    expect(JSON.parse(after.notes).find((row: { id: string }) => row.id === note.id).entity_id).toBe(String(customer.id));
    expect(JSON.parse(after.event_logs).find((row: { id: string }) => row.id === event.id).entity_id).toBe(String(vendor.id));
    const items = JSON.parse(after.action_items) as Array<{ id: string; entity_id: string; metadata: Record<string, unknown> }>;
    expect(items.find((row) => row.id === onCustomer.id)?.entity_id).toBe(String(customer.id));
    expect(items.find((row) => row.id === review.id)?.metadata).toEqual({
      candidateCustomerIds: [customer.id, other.id],
      attachedCustomerId: customer.id,
      quoteId: quote.id,
    });

    // Sync's own record is the only Event log it adds.
    const syncEventsAfter = await db
      .select()
      .from(eventLogs)
      .where(eq(eventLogs.eventType, SYNC_RAN_EVENT));
    expect(syncEventsAfter).toHaveLength(syncEventsBefore.length + 1);
    const last = await getLastSync();
    expect(last).toMatchObject({ userEmail: actor.email, applied: result.applied, notFixable: 0 });
  });
});

describe("Sync follows the old app", () => {
  it("carries edits, archives, a merge, removed aliases and files, a cleared address and repointed links, with stable ids", async () => {
    const admin = { userId: fixture.userId, email: actor.email, role: "Admin" as const };
    const edited = await fixture.seedCustomer({
      companyName: `Edit Co ${tag}`,
      email: `edit-${tag}@example.invalid`,
      billingAddressLine1: "1 Main St",
      billingCity: "Springfield",
      shippingAddressLine1: "2 Dock Rd",
    });
    const archived = await fixture.seedCustomer({ email: `archive-${tag}@example.invalid` });
    const survivor = await fixture.seedCustomer(
      { companyName: `Merge Co ${tag}`, email: `survivor-${tag}@example.invalid` },
      [`survivor-${tag}@example.invalid`],
    );
    const merged = await fixture.seedCustomer(
      { companyName: `Merge Co ${tag}`, contactName: "Second Person", email: `merged-${tag}@example.invalid` },
      [`merged-${tag}@example.invalid`, `merged-old-${tag}@example.invalid`],
    );
    const aliasHolder = await fixture.seedCustomer(
      { email: `holder-${tag}@example.invalid` },
      [`holder-${tag}@example.invalid`, `gone-${tag}@example.invalid`],
    );
    const fileHolder = await fixture.seedCustomer();
    const quoteFrom = await fixture.seedCustomer();
    const quoteTo = await fixture.seedCustomer();
    const vendor = await fixture.seedVendor({ companyName: `Shop ${tag}`, discordId: "1", notes: "First note" });
    const otherVendor = await fixture.seedVendor();

    const mergedQuote = await fixture.seedQuote(merged.id, vendor.id);
    const mergedOrder = await fixture.seedOrder(merged.id, vendor.id);
    const mergedPart = await fixture.seedPart(merged.id);
    const mergedCommunication = await fixture.seedCommunication(merged.id);
    const shared = await fixture.seedAttachment({ customerIds: [survivor.id, merged.id] });
    const mergedOnly = await fixture.seedAttachment({ customerIds: [merged.id] });
    const unlinked = await fixture.seedAttachment({ customerIds: [fileHolder.id] });
    const kept = await fixture.seedAttachment({ customerIds: [fileHolder.id] });
    const moved = await fixture.seedQuote(quoteFrom.id, vendor.id);
    const movedOrder = await fixture.seedOrder(quoteFrom.id, vendor.id);

    await runSync(actor);
    await expectNoDifferences();
    const idsBefore = await copyIds();
    const editedBefore = await readCopy("customer", edited.id);

    // --- What staff do in today's app ---
    await updateCustomer(edited.id, {
      displayName: `Edited ${tag}`,
      companyName: null,
      contactName: "New Person",
      email: `edited-${tag}@example.invalid`,
      phone: "555-0199",
      paymentTerms: "Net 45",
      billingAddressLine1: null,
      billingCity: null,
      shippingAddressLine1: "3 New Dock Rd",
    });
    await archiveCustomer(archived.id);
    await mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, admin);
    await db
      .delete(customerEmailAliases)
      .where(
        and(
          eq(customerEmailAliases.customerId, aliasHolder.id),
          eq(customerEmailAliases.email, `gone-${tag}@example.invalid`),
        ),
      );
    await unlinkAttachmentFromCustomer(fileHolder.id, unlinked.id);
    await db.update(quotes).set({ customerId: quoteTo.id, vendorId: otherVendor.id }).where(eq(quotes.id, moved.id));
    await db.update(orders).set({ customerId: quoteTo.id, vendorId: null }).where(eq(orders.id, movedOrder.id));
    await updateVendor(vendor.id, { companyName: null, discordId: "2", notes: null, isPrimaryContact: true });
    const created = await createCustomer({ displayName: `Brand new ${tag}`, email: `new-${tag}@example.invalid` });
    fixture.customerIds.push(created.id);

    // --- Check sees each of them ---
    const report = await runCheck();
    const areas = new Set(report.differences.map((difference) => difference.area));
    for (const area of ["missing", "organization", "contact", "account", "address", "alias", "file", "communication", "merge", "link"] as const) {
      expect(areas, `Check reports ${area} differences`).toContain(area);
    }
    expect(report.notFixable).toBe(0);
    const forRow = (type: string, id: number) =>
      report.differences.filter((d) => d.legacyType === type && d.legacyId === id);
    expect(forRow("customer", edited.id).every((d) => d.href === `/customers/${edited.id}`)).toBe(true);
    expect(forRow("customer", edited.id).map((d) => d.detail).join("\n")).toMatch(/Organization type is "business"; the old row gives "individual"/);
    expect(forRow("customer", edited.id).some((d) => /no billing address any more/.test(d.detail))).toBe(true);
    expect(forRow("customer", archived.id).map((d) => d.area).sort()).toEqual(["account", "contact", "organization"]);
    expect(forRow("vendor", vendor.id).every((d) => d.href === `/vendors/${vendor.id}`)).toBe(true);
    expect(report.differences.some((d) => d.href === `/quotes/${moved.id}`)).toBe(true);
    expect(report.differences.some((d) => d.href === `/orders/${encodeURIComponent(movedOrder.orderNumber)}`)).toBe(true);

    // --- Sync clears them ---
    const result = await runSync(actor);
    expect(result).toMatchObject({ applied: report.fixable, passes: 1, notFixable: 0 });
    await expectNoDifferences();

    for (const id of fixture.customerIds) await expectCopyMatchesMapping("customer", id);
    for (const id of fixture.vendorIds) await expectCopyMatchesMapping("vendor", id);

    // Every uuid is the one it was before.
    const idsAfter = await copyIds();
    for (const [key, ids] of Object.entries(idsBefore)) expect(idsAfter[key], key).toEqual(ids);

    // The edit: the billing address is gone, the shipping one kept its id.
    const editedAfter = await readCopy("customer", edited.id);
    expect(editedAfter?.organization).toMatchObject({ kind: "individual", name: `Edited ${tag}` });
    expect(editedAfter?.contact).toMatchObject({ name: "New Person", email: `edited-${tag}@example.invalid` });
    expect(editedAfter?.account).toMatchObject({ paymentTerms: "Net 45", billingAddressId: null });
    expect(editedAfter?.addresses).toHaveLength(1);
    expect(editedAfter?.shippingAddress).toMatchObject({ id: editedBefore?.shippingAddress?.id, line1: "3 New Dock Rd" });
    expect(editedAfter?.aliases).toEqual([`edited-${tag}@example.invalid`]);

    // The archive.
    const archivedAfter = await readCopy("customer", archived.id);
    expect(archivedAfter?.organization.isArchived).toBe(true);
    expect(archivedAfter?.account.isArchived).toBe(true);
    expect(archivedAfter?.contact?.isArchived).toBe(true);

    // The merge: pointer set, records moved to the survivor's account.
    const survivorAfter = await readCopy("customer", survivor.id);
    const mergedAfter = await readCopy("customer", merged.id);
    expect(mergedAfter?.organization).toMatchObject({
      isArchived: true,
      mergedIntoOrganizationId: survivorAfter?.organization.id,
    });
    expect(survivorAfter?.aliases).toEqual(
      [`merged-${tag}@example.invalid`, `merged-old-${tag}@example.invalid`, `survivor-${tag}@example.invalid`].sort(),
    );
    expect(mergedAfter?.aliases).toEqual([`merged-${tag}@example.invalid`]);
    expect(survivorAfter?.fileIds).toEqual([shared.id, mergedOnly.id].sort());
    expect(mergedAfter?.fileIds).toEqual([]);
    expect(survivorAfter?.communicationIds).toEqual([mergedCommunication.id]);
    expect(mergedAfter?.communicationIds).toEqual([]);
    const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, mergedQuote.id));
    const [orderRow] = await db.select().from(orders).where(eq(orders.id, mergedOrder.id));
    const [partRow] = await db.select().from(parts).where(eq(parts.id, mergedPart.id));
    expect(quoteRow.customerAccountId).toBe(survivorAfter?.account.id);
    expect(orderRow.customerAccountId).toBe(survivorAfter?.account.id);
    expect(partRow.customerAccountId).toBe(survivorAfter?.account.id);

    // The removed alias and the unlinked file.
    expect((await readCopy("customer", aliasHolder.id))?.aliases).toEqual([`holder-${tag}@example.invalid`]);
    expect((await readCopy("customer", fileHolder.id))?.fileIds).toEqual([kept.id]);

    // The repointed Quote and Order follow the old ids, including a cleared Vendor.
    const [movedRow] = await db.select().from(quotes).where(eq(quotes.id, moved.id));
    const [movedOrderRow] = await db.select().from(orders).where(eq(orders.id, movedOrder.id));
    expect(movedRow.customerAccountId).toBe((await readCopy("customer", quoteTo.id))?.account.id);
    expect(movedRow.vendorAccountId).toBe((await readCopy("vendor", otherVendor.id))?.account.id);
    expect(movedOrderRow.customerAccountId).toBe((await readCopy("customer", quoteTo.id))?.account.id);
    expect(movedOrderRow.vendorAccountId).toBeNull();

    // An un-merge and un-archive done by hand carry over too.
    await db
      .update(customers)
      .set({ isArchived: false, mergedIntoCustomerId: null })
      .where(eq(customers.id, merged.id));
    expect((await runCheck()).differences.map((d) => d.area).sort()).toEqual(["account", "contact", "merge", "organization"]);
    await runSync(actor);
    await expectNoDifferences();
    expect((await readCopy("customer", merged.id))?.organization).toMatchObject({
      isArchived: false,
      mergedIntoOrganizationId: null,
    });
    expect((await copyIds())[`customer:${merged.id}`]).toEqual(idsBefore[`customer:${merged.id}`]);
  });

  it("removes the copy of a Customer that was hard-deleted, and today's deletes still work after a Sync", async () => {
    const doomed = await fixture.seedCustomer({
      email: `doomed-${tag}@example.invalid`,
      billingAddressLine1: "1 Main St",
    });
    const keeper = await fixture.seedCustomer();
    const file = await fixture.seedAttachment({ customerIds: [doomed.id, keeper.id] });
    await db.update(customers).set({ isArchived: true, mergedIntoCustomerId: doomed.id }).where(eq(customers.id, keeper.id));
    await runSync(actor);
    const copy = await readCopy("customer", doomed.id);
    expect(copy).not.toBeNull();

    // Today's attachment delete knows nothing about organization_attachments.
    await unlinkAttachmentFromCustomer(doomed.id, file.id);
    await unlinkAttachmentFromCustomer(keeper.id, file.id);
    await deleteAttachment(file.id);
    expect(await db.select().from(attachments).where(eq(attachments.id, file.id))).toEqual([]);
    await expectNoDifferences();

    // Today's Customer delete knows nothing about the copy either.
    await deleteCustomer(doomed.id);
    // (It also cleared the pointer of the Customer that was merged into it.)
    const report = await runCheck();
    expect(report.differences).toEqual([
      expect.objectContaining({ area: "merge", legacyId: keeper.id, fixable: true }),
      expect.objectContaining({
        area: "extra",
        legacyType: "customer",
        legacyId: doomed.id,
        fixable: true,
      }),
    ]);

    await runSync(actor);
    await expectNoDifferences();
    expect(await readCopy("customer", doomed.id)).toBeNull();
    expect(await db.select().from(organizations).where(eq(organizations.id, copy!.organization.id))).toEqual([]);
    expect(await db.select().from(accounts).where(eq(accounts.id, copy!.account.id))).toEqual([]);
    expect(await db.select().from(contacts).where(eq(contacts.id, copy!.contact!.id))).toEqual([]);
    expect(await db.select().from(addresses).where(eq(addresses.organizationId, copy!.organization.id))).toEqual([]);
    // The survivor pointer that aimed at the deleted Customer was cleared by the old app.
    expect((await readCopy("customer", keeper.id))?.organization.mergedIntoOrganizationId).toBeNull();
  });
});

describe("Sync repairs what it can identify", () => {
  it("adds addresses an old row gains, keeps their ids afterwards, and recreates a lost Contact", async () => {
    const customer = await fixture.seedCustomer(
      { companyName: `Grow Co ${tag}`, contactName: "Pat Example", email: `grow-${tag}@example.invalid` },
      [`grow-alias-${tag}@example.invalid`],
    );
    await runSync(actor);
    const bare = (await readCopy("customer", customer.id))!;
    expect(bare.addresses).toEqual([]);

    await updateCustomer(customer.id, {
      billingAddressLine1: "1 Main St",
      billingCity: "Springfield",
      shippingAddressLine1: "2 Dock Rd",
    });
    expect((await runCheck()).differences.map((d) => d.detail).sort()).toEqual([
      "The billing address is missing",
      "The shipping address is missing",
    ]);
    await runSync(actor);
    await expectNoDifferences();
    const grown = (await readCopy("customer", customer.id))!;
    expect(grown.billingAddress).toMatchObject({ label: "Billing", line1: "1 Main St", isDefaultShipping: false });
    expect(grown.shippingAddress).toMatchObject({ label: "Shipping", line1: "2 Dock Rd", isDefaultShipping: true });

    // An edit to an address keeps the address row.
    await updateCustomer(customer.id, { billingCity: "Shelbyville", shippingAddressLine2: "Bay 2" });
    await runSync(actor);
    await expectNoDifferences();
    const edited = (await readCopy("customer", customer.id))!;
    expect(edited.billingAddress).toMatchObject({ id: grown.billingAddress!.id, city: "Shelbyville" });
    expect(edited.shippingAddress).toMatchObject({ id: grown.shippingAddress!.id, line2: "Bay 2" });

    // A billing pointer that aims at the shipping address gets an address of its own again.
    await db.update(accounts).set({ billingAddressId: edited.shippingAddress!.id }).where(eq(accounts.id, edited.account.id));
    await db.delete(addresses).where(eq(addresses.id, edited.billingAddress!.id));
    expect((await runCheck()).differences.map((d) => d.detail)).toEqual(["The billing address is missing"]);
    await runSync(actor);
    await expectNoDifferences();

    // A copy whose Contact is gone gets one back, with its aliases; the other ids stay.
    await db.delete(organizationContacts).where(eq(organizationContacts.organizationId, bare.organization.id));
    await db.execute(sql`delete from contact_email_aliases where contact_id = ${bare.contact!.id}`);
    await db.delete(contacts).where(eq(contacts.id, bare.contact!.id));
    const report = await runCheck();
    expect(report.notFixable).toBe(0);
    expect(report.differences.map((d) => d.area).sort()).toEqual(["alias", "alias", "contact"]);
    await runSync(actor);
    await expectNoDifferences();
    const repaired = (await readCopy("customer", customer.id))!;
    expect(repaired.organization.id).toBe(bare.organization.id);
    expect(repaired.account.id).toBe(bare.account.id);
    expect(repaired.contact).toMatchObject({ name: "Pat Example", email: `grow-${tag}@example.invalid` });
    expect(repaired.aliases).toEqual([`grow-${tag}@example.invalid`, `grow-alias-${tag}@example.invalid`].sort());
    await expectCopyMatchesMapping("customer", customer.id);
  });
});

describe("what Sync refuses", () => {
  it("does not run unless the stage is Shadow", async () => {
    const customer = await fixture.seedCustomer();
    const before = await snapshotNewData();
    for (const stage of ["switch", "unlocked"] as const) {
      await setCutoverStage(stage, { actor, source: "user" });
      await expect(runSync(actor)).rejects.toMatchObject({ name: "SyncError", code: "wrong_stage" });
      expect(await snapshotNewData()).toEqual(before);
    }
    expect((await getCutoverStage())?.stage).toBe("unlocked");
    await recordShadowStage();
    await runSync(actor);
    expect(await readCopy("customer", customer.id)).not.toBeNull();
  });

  it("does not run beside another Sync", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('organizations-sync'))`);
      const error = await runSync(actor).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SyncError);
      expect(error).toMatchObject({ code: "busy" });
    });
  });

  it("reports a shape it does not expect and leaves it alone", async () => {
    const customer = await fixture.seedCustomer({ email: `odd-${tag}@example.invalid` });
    const quote = await fixture.seedQuote(customer.id);
    await runSync(actor);
    const copy = (await readCopy("customer", customer.id))!;

    // A second Contact, which nothing before Unlock can create.
    const [stray] = await db.insert(contacts).values({ name: "Stray Person" }).returning();
    const [link] = await db
      .insert(organizationContacts)
      .values({ organizationId: copy.organization.id, contactId: stray.id })
      .returning();
    // And an Organization that is not the copy of anything.
    const [loose] = await db.insert(organizations).values({ kind: "business", name: `Loose ${tag}` }).returning();
    await updateCustomer(customer.id, { displayName: `Changed ${tag}` });

    try {
      const report = await runCheck();
      expect(report.differences).toEqual([
        expect.objectContaining({
          area: "structure",
          legacyType: "customer",
          legacyId: customer.id,
          href: `/customers/${customer.id}`,
          fixable: false,
        }),
        expect.objectContaining({ area: "extra", name: `Loose ${tag}`, fixable: false }),
      ]);

      const newBefore = await snapshotNewData();
      const result = await runSync(actor);
      expect(result).toMatchObject({ applied: 0, notFixable: 2 });
      expect(await snapshotNewData()).toEqual(newBefore);
      const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(quoteRow.customerAccountId).toBe(copy.account.id);
    } finally {
      await db.delete(organizationContacts).where(eq(organizationContacts.id, link.id));
      await db.delete(contacts).where(eq(contacts.id, stray.id));
      await db.delete(organizations).where(eq(organizations.id, loose.id));
    }

    // Once the shape is repaired, Sync carries the waiting edit.
    await runSync(actor);
    await expectNoDifferences();
    expect((await readCopy("customer", customer.id))?.organization.name).toBe(`Changed ${tag}`);
  });

  it("Check changes nothing", async () => {
    await fixture.seedCustomer();
    const before = { ...(await snapshotNewData()), ...(await snapshotOldData()) };
    const report = await runCheck();
    expect(report.total).toBeGreaterThan(0);
    expect({ ...(await snapshotNewData()), ...(await snapshotOldData()) }).toEqual(before);
    await runSync(actor);
    await expectNoDifferences();
    // Nothing of this file's is left pointing at a row another file owns.
    expect(await db.select({ id: quotes.id }).from(quotes).where(inArray(quotes.id, fixture.quoteIds))).toHaveLength(fixture.quoteIds.length);
  });
});
