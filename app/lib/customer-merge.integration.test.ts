/**
 * Customer merge module (duplicate detection, dismissals, preview, merge).
 * Requires DATABASE_URL pointing at a migrated Postgres instance.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, or, sql } from "drizzle-orm";

import { getActionItemsForUser, resolveActionItem } from "./action-items.server";
import {
  dismissCustomerGroup,
  findDuplicateGroups,
  mergeCustomers,
  previewMerge,
  undismissPair,
  type DuplicateGroup,
  type MergeActor,
} from "./customer-merge.server";
import { resolveFinalCustomerId } from "./customer-match-review.server";
import { db } from "./db";
import {
  actionItems,
  attachments,
  customerAttachments,
  customerCommunications,
  customerEmailAliases,
  customerMergeDismissals,
  customers,
  eventLogs,
  notes,
  orders,
  parts,
  quotes,
  users,
} from "./db/schema";

const tag = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}-${tag}@example.invalid`;

const adminId = `merge-admin-${tag}`;
const admin: MergeActor = {
  userId: adminId,
  email: `${adminId}@example.invalid`,
  role: "Admin",
};

const createdCustomerIds: number[] = [];
const createdActionItemIds: string[] = [];
const createdAttachmentIds: string[] = [];

type SeedCustomer = {
  title?: string | null;
  paymentTerms?: string | null;
  billing?: Partial<{
    line1: string; line2: string; city: string; state: string; postal: string; country: string;
  }>;
  shipping?: Partial<{
    line1: string; line2: string; city: string; state: string; postal: string; country: string;
  }>;
  displayName?: string;
  email?: string | null;
  aliases?: string[];
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  isArchived?: boolean;
};

async function seedCustomer(input: SeedCustomer = {}) {
  const [customer] = await db
    .insert(customers)
    .values({
      displayName: input.displayName ?? `Seed ${tag} ${randomUUID().slice(0, 6)}`,
      email: input.email ?? null,
      companyName: input.companyName ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      title: input.title ?? null,
      paymentTerms: input.paymentTerms ?? null,
      billingAddressLine1: input.billing?.line1 ?? null,
      billingAddressLine2: input.billing?.line2 ?? null,
      billingCity: input.billing?.city ?? null,
      billingState: input.billing?.state ?? null,
      billingPostalCode: input.billing?.postal ?? null,
      ...(input.billing?.country ? { billingCountry: input.billing.country } : {}),
      shippingAddressLine1: input.shipping?.line1 ?? null,
      shippingAddressLine2: input.shipping?.line2 ?? null,
      shippingCity: input.shipping?.city ?? null,
      shippingState: input.shipping?.state ?? null,
      shippingPostalCode: input.shipping?.postal ?? null,
      ...(input.shipping?.country ? { shippingCountry: input.shipping.country } : {}),
      isArchived: input.isArchived ?? false,
    })
    .returning();
  createdCustomerIds.push(customer.id);
  if (input.aliases?.length) {
    await db.insert(customerEmailAliases).values(
      input.aliases.map((email) => ({ customerId: customer.id, email })),
    );
  }
  return customer;
}

type SeedHistory = {
  quotes?: number;
  orders?: number;
  parts?: number;
  communications?: number;
  notes?: number;
};

async function seedHistory(customerId: number, history: SeedHistory) {
  for (let i = 0; i < (history.quotes ?? 0); i++) {
    await db.insert(quotes).values({
      quoteNumber: `T${randomUUID().slice(0, 10)}`,
      customerId,
    });
  }
  for (let i = 0; i < (history.orders ?? 0); i++) {
    await db.insert(orders).values({
      orderNumber: `T${randomUUID().slice(0, 10)}`,
      customerId,
    });
  }
  for (let i = 0; i < (history.parts ?? 0); i++) {
    await db.insert(parts).values({ customerId, partName: `Part ${i}` });
  }
  for (let i = 0; i < (history.communications ?? 0); i++) {
    await db.insert(customerCommunications).values({
      customerId,
      method: "call",
      note: `Call ${i}`,
      createdBy: adminId,
    });
  }
  for (let i = 0; i < (history.notes ?? 0); i++) {
    await db.insert(notes).values({
      entityType: "customer",
      entityId: String(customerId),
      content: `Note ${i}`,
      createdBy: adminId,
    });
  }
}

async function seedAttachment(customerIds: number[]) {
  const [attachment] = await db
    .insert(attachments)
    .values({
      s3Bucket: "integration-test",
      s3Key: `customer-merge/${tag}/${randomUUID()}.pdf`,
      fileName: "spec.pdf",
      contentType: "application/pdf",
    })
    .returning({ id: attachments.id });
  createdAttachmentIds.push(attachment.id);
  await db.insert(customerAttachments).values(
    customerIds.map((customerId) => ({ customerId, attachmentId: attachment.id })),
  );
  return attachment.id;
}

async function recordCounts(customerId: number) {
  const [row] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from quotes where customer_id = ${customerId}) quotes,
      (select count(*)::int from orders where customer_id = ${customerId}) orders,
      (select count(*)::int from parts where customer_id = ${customerId}) parts,
      (select count(*)::int from customer_communications where customer_id = ${customerId}) communications,
      (select count(*)::int from notes where entity_type = 'customer' and entity_id = ${String(customerId)}) notes,
      (select count(*)::int from customer_attachments where customer_id = ${customerId}) attachments
  `);
  return row;
}

async function customerRow(id: number) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  return row;
}

async function aliasesOf(id: number) {
  const rows = await db
    .select({ email: customerEmailAliases.email })
    .from(customerEmailAliases)
    .where(eq(customerEmailAliases.customerId, id));
  return rows.map((row) => row.email).sort();
}

function groupContaining(groups: DuplicateGroup[], customerId: number) {
  return groups.find((group) =>
    group.customers.some((customer) => customer.id === customerId),
  );
}

const idsOf = (group: DuplicateGroup | undefined) =>
  group?.customers.map((customer) => customer.id).sort((a, b) => a - b);

describe("customer merge module", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await db.insert(users).values({
      id: adminId,
      email: admin.email!,
      role: "Admin",
    });
  });

  afterAll(async () => {
    const ids = [...new Set(createdCustomerIds)];
    if (ids.length > 0) {
      if (createdActionItemIds.length > 0) {
        await db.delete(actionItems).where(inArray(actionItems.id, createdActionItemIds));
      }
      await db.execute(sql`delete from event_logs where entity_type = 'customer' and entity_id in ${ids.map(String)}`);
      await db.execute(sql`delete from customer_attachments where customer_id in ${ids}`);
      if (createdAttachmentIds.length > 0) {
        await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
      }
      await db.execute(sql`delete from customer_communications where customer_id in ${ids}`);
      await db.execute(sql`delete from notes where entity_type = 'customer' and entity_id in ${ids.map(String)}`);
      await db.execute(sql`delete from quotes where customer_id in ${ids}`);
      await db.execute(sql`delete from orders where customer_id in ${ids}`);
      await db.execute(sql`delete from parts where customer_id in ${ids}`);
      await db.delete(customerMergeDismissals).where(
        or(
          inArray(customerMergeDismissals.lowCustomerId, ids),
          inArray(customerMergeDismissals.highCustomerId, ids),
        ),
      );
      await db.delete(customerEmailAliases).where(inArray(customerEmailAliases.customerId, ids));
      await db.update(customers).set({ mergedIntoCustomerId: null }).where(inArray(customers.id, ids));
      await db.delete(customers).where(inArray(customers.id, ids));
    }
    await db.delete(users).where(eq(users.id, adminId));
  });

  describe("finding duplicates", () => {
    it("groups Customers whose emails match after normalization in the Same email tier", async () => {
      const email = emailFor("dup-primary");
      const a = await seedCustomer({ email });
      const b = await seedCustomer({ email: `  ${email.toUpperCase()}.` });
      const unrelated = await seedCustomer({ email: emailFor("dup-unrelated") });

      const { sameEmail } = await findDuplicateGroups();

      const group = groupContaining(sameEmail, a.id);
      expect(idsOf(group)).toEqual([a.id, b.id].sort((x, y) => x - y));
      expect(group?.reasons).toEqual([{ kind: "email", value: email }]);
      expect(groupContaining(sameEmail, unrelated.id)).toBeUndefined();
    });

    it("counts an alias that coincides with another Customer's primary email", async () => {
      const email = emailFor("dup-alias");
      const holder = await seedCustomer({
        email: emailFor("dup-alias-holder"),
        aliases: [email],
      });
      const other = await seedCustomer({ email });

      const { sameEmail } = await findDuplicateGroups();

      expect(idsOf(groupContaining(sameEmail, holder.id))).toEqual(
        [holder.id, other.id].sort((x, y) => x - y),
      );
    });

    it("joins Customers linked through different shared emails into one group", async () => {
      const first = emailFor("chain-1");
      const second = emailFor("chain-2");
      const a = await seedCustomer({ email: first });
      const b = await seedCustomer({ email: first, aliases: [second] });
      const c = await seedCustomer({ email: second });

      const { sameEmail } = await findDuplicateGroups();

      expect(idsOf(groupContaining(sameEmail, a.id))).toEqual(
        [a.id, b.id, c.id].sort((x, y) => x - y),
      );
    });

    it("excludes archived Customers", async () => {
      const email = emailFor("dup-archived");
      const active = await seedCustomer({ email });
      await seedCustomer({ email, isArchived: true });

      const { sameEmail } = await findDuplicateGroups();

      expect(groupContaining(sameEmail, active.id)).toBeUndefined();
    });

    it("summarises each Customer with name, contact details, record counts and last activity", async () => {
      const email = emailFor("dup-summary");
      const a = await seedCustomer({
        email,
        displayName: `Summary A ${tag}`,
        companyName: "Summary Co",
        phone: "+15550001",
      });
      const b = await seedCustomer({ email });
      await db.insert(quotes).values([
        { quoteNumber: `T${randomUUID().slice(0, 10)}`, customerId: a.id, createdAt: new Date("2026-03-01T00:00:00Z") },
        { quoteNumber: `T${randomUUID().slice(0, 10)}`, customerId: a.id, createdAt: new Date("2026-04-01T00:00:00Z") },
      ]);
      await db.insert(orders).values({
        orderNumber: `T${randomUUID().slice(0, 10)}`,
        customerId: a.id,
        createdAt: new Date("2026-05-01T00:00:00Z"),
      });

      const { sameEmail } = await findDuplicateGroups();
      const group = groupContaining(sameEmail, a.id);
      const summaryA = group?.customers.find((c) => c.id === a.id);
      const summaryB = group?.customers.find((c) => c.id === b.id);

      expect(summaryA).toMatchObject({
        displayName: `Summary A ${tag}`,
        companyName: "Summary Co",
        email,
        phone: "+15550001",
        quoteCount: 2,
        orderCount: 1,
        lastActivityAt: new Date("2026-05-01T00:00:00Z"),
      });
      expect(summaryB).toMatchObject({
        quoteCount: 0,
        orderCount: 0,
        lastActivityAt: null,
      });
    });

    describe("Possible duplicates tier", () => {
      it("suggests Customers sharing a normalized company name", async () => {
        const a = await seedCustomer({ companyName: `Acme   Widgets, Inc. ${tag}` });
        const b = await seedCustomer({ companyName: `acme widgets inc ${tag}` });
        const other = await seedCustomer({ companyName: `Other Co ${tag}` });

        const { possible, sameEmail } = await findDuplicateGroups();

        const group = groupContaining(possible, a.id);
        expect(idsOf(group)).toEqual([a.id, b.id].sort((x, y) => x - y));
        expect(group?.reasons).toEqual([
          { kind: "company", value: `acme widgets inc ${tag}` },
        ]);
        expect(groupContaining(possible, other.id)).toBeUndefined();
        expect(groupContaining(sameEmail, a.id)).toBeUndefined();
      });

      it("suggests Customers sharing the same phone digits despite formatting", async () => {
        const digits = `1555${tag.replace(/\D/g, "").padEnd(6, "7").slice(0, 6)}`;
        const a = await seedCustomer({ phone: `+${digits}` });
        const b = await seedCustomer({ phone: digits.replace(/(\d)(\d{3})(\d{3})(\d+)/, "$1 ($2) $3-$4") });

        const { possible } = await findDuplicateGroups();

        const group = groupContaining(possible, a.id);
        expect(idsOf(group)).toEqual([a.id, b.id].sort((x, y) => x - y));
        expect(group?.reasons).toEqual([{ kind: "phone", value: digits }]);
      });

      it("suggests Customers sharing an identical contact name", async () => {
        const name = `Pat Quincy ${tag}`;
        const a = await seedCustomer({ contactName: name });
        const b = await seedCustomer({ contactName: `  ${name.toUpperCase()}  ` });

        const { possible } = await findDuplicateGroups();

        const group = groupContaining(possible, a.id);
        expect(idsOf(group)).toEqual([a.id, b.id].sort((x, y) => x - y));
        expect(group?.reasons).toEqual([
          { kind: "name", value: name.toLowerCase() },
        ]);
      });

      it("excludes archived Customers", async () => {
        const company = `Archived Co ${tag}`;
        const active = await seedCustomer({ companyName: company });
        await seedCustomer({ companyName: company, isArchived: true });

        const { possible } = await findDuplicateGroups();

        expect(groupContaining(possible, active.id)).toBeUndefined();
      });
    });

    describe("dismissing non-duplicates", () => {
      it("hides a dismissed pair until the dismissed view is requested, with who and when", async () => {
        const email = emailFor("dismiss-pair");
        const a = await seedCustomer({ email });
        const b = await seedCustomer({ email });

        await dismissCustomerGroup([b.id, a.id], admin);

        const hidden = await findDuplicateGroups();
        expect(groupContaining(hidden.sameEmail, a.id)).toBeUndefined();

        const shown = await findDuplicateGroups({ includeDismissed: true });
        const group = groupContaining(shown.sameEmail, a.id);
        expect(idsOf(group)).toEqual([a.id, b.id].sort((x, y) => x - y));
        expect(group?.dismissedPairs).toEqual([
          {
            lowCustomerId: Math.min(a.id, b.id),
            highCustomerId: Math.max(a.id, b.id),
            dismissedBy: adminId,
            dismissedByLabel: admin.email,
            dismissedAt: expect.any(Date),
          },
        ]);
      });

      it("dismisses every pair when a group of three is dismissed, and can un-dismiss one pair", async () => {
        const email = emailFor("dismiss-trio");
        const [a, b, c] = [
          await seedCustomer({ email }),
          await seedCustomer({ email }),
          await seedCustomer({ email }),
        ];

        await dismissCustomerGroup([a.id, b.id, c.id], admin);

        expect(
          groupContaining((await findDuplicateGroups()).sameEmail, a.id),
        ).toBeUndefined();
        const shown = groupContaining(
          (await findDuplicateGroups({ includeDismissed: true })).sameEmail,
          a.id,
        );
        expect(shown?.dismissedPairs).toHaveLength(3);

        await undismissPair(a.id, b.id, admin);

        const afterUndismiss = groupContaining(
          (await findDuplicateGroups()).sameEmail,
          a.id,
        );
        expect(idsOf(afterUndismiss)).toEqual([a.id, b.id]);
      });

      it("remembers dismissals for every user and ignores repeat dismissals", async () => {
        const email = emailFor("dismiss-repeat");
        const a = await seedCustomer({ email });
        const b = await seedCustomer({ email });

        await dismissCustomerGroup([a.id, b.id], admin);
        await expect(dismissCustomerGroup([a.id, b.id], admin)).resolves.toBeUndefined();

        const rows = await db
          .select()
          .from(customerMergeDismissals)
          .where(eq(customerMergeDismissals.lowCustomerId, Math.min(a.id, b.id)));
        expect(rows).toHaveLength(1);
      });

      it("only lets Admin or Dev dismiss", async () => {
        const a = await seedCustomer({ email: emailFor("dismiss-auth") });
        const b = await seedCustomer({ email: emailFor("dismiss-auth") });

        await expect(
          dismissCustomerGroup([a.id, b.id], { ...admin, role: "User" }),
        ).rejects.toMatchObject({ status: 403 });
      });
    });
  });

  describe("Customer match review Action Items", () => {
    async function seedReviewItem(candidateIds: number[]) {
      const [item] = await db
        .insert(actionItems)
        .values({
          type: "customer_match_review",
          title: `Review Customer match ${tag}`,
          description: "Several Customers match",
          entityType: "quote",
          entityId: "0",
          metadata: { candidateCustomerIds: candidateIds },
        })
        .returning();
      createdActionItemIds.push(item.id);
      return item.id;
    }

    async function statusOf(itemId: string) {
      const [row] = await db
        .select({ status: actionItems.status, resolution: actionItems.resolution })
        .from(actionItems)
        .where(eq(actionItems.id, itemId));
      return row;
    }

    it("resolves once its candidates are merged into one Customer", async () => {
      const a = await seedCustomer({ email: emailFor("review-merge") });
      const b = await seedCustomer({ email: emailFor("review-merge") });
      const itemId = await seedReviewItem([a.id, b.id]);

      await mergeCustomers({ survivorId: a.id, mergedId: b.id }, admin);

      expect(await statusOf(itemId)).toMatchObject({ status: "resolved" });
    });

    it("stays open while candidates remain distinct, then resolves when the rest are dismissed", async () => {
      const email = emailFor("review-partial");
      const [a, b, c] = [
        await seedCustomer({ email }),
        await seedCustomer({ email }),
        await seedCustomer({ email }),
      ];
      const itemId = await seedReviewItem([a.id, b.id, c.id]);

      await mergeCustomers({ survivorId: a.id, mergedId: b.id }, admin);
      expect(await statusOf(itemId)).toMatchObject({ status: "active" });

      await dismissCustomerGroup([a.id, c.id], admin);
      expect(await statusOf(itemId)).toMatchObject({
        status: "resolved",
        resolution: "Confirmed not duplicates",
      });
    });

    it("resolves when every pair of candidates is dismissed as not duplicates", async () => {
      const a = await seedCustomer({ email: emailFor("review-dismiss") });
      const b = await seedCustomer({ email: emailFor("review-dismiss") });
      const itemId = await seedReviewItem([a.id, b.id]);

      await dismissCustomerGroup([a.id, b.id], admin);

      expect(await statusOf(itemId)).toMatchObject({ status: "resolved" });
    });

    it("leaves an item open when only some pairs are dismissed", async () => {
      const email = emailFor("review-some");
      const [a, b, c] = [
        await seedCustomer({ email }),
        await seedCustomer({ email }),
        await seedCustomer({ email }),
      ];
      const itemId = await seedReviewItem([a.id, b.id, c.id]);

      await dismissCustomerGroup([a.id, b.id], admin);

      expect(await statusOf(itemId)).toMatchObject({ status: "active" });
    });

    it("resolves an item whose candidates were already merged the next time it is evaluated", async () => {
      const a = await seedCustomer({ email: emailFor("review-late") });
      const b = await seedCustomer({ email: emailFor("review-late") });
      await mergeCustomers({ survivorId: a.id, mergedId: b.id }, admin);
      const itemId = await seedReviewItem([a.id, b.id]);
      expect(await statusOf(itemId)).toMatchObject({ status: "active" });

      const visible = await getActionItemsForUser(adminId);

      expect(visible.some((item) => item.id === itemId)).toBe(false);
      expect(await statusOf(itemId)).toMatchObject({ status: "resolved" });
    });

    it("cannot be resolved by hand without a real decision", async () => {
      const a = await seedCustomer({ email: emailFor("review-manual") });
      const b = await seedCustomer({ email: emailFor("review-manual") });
      const itemId = await seedReviewItem([a.id, b.id]);

      await expect(
        resolveActionItem(itemId, { userId: adminId, role: "Admin" }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await statusOf(itemId)).toMatchObject({ status: "active" });
    });
  });

  describe("merging two Customers", () => {
    it("moves Quotes, Orders, Parts, communications, Notes and Attachments to the survivor", async () => {
      const survivor = await seedCustomer({ email: emailFor("merge-all-s") });
      const merged = await seedCustomer({ email: emailFor("merge-all-m") });
      await seedHistory(survivor.id, { quotes: 1, orders: 1, parts: 1, communications: 1, notes: 1 });
      await seedHistory(merged.id, { quotes: 2, orders: 3, parts: 1, communications: 2, notes: 2 });
      await seedAttachment([merged.id]);
      await seedAttachment([merged.id]);

      const result = await mergeCustomers(
        { survivorId: survivor.id, mergedId: merged.id },
        admin,
      );

      expect(result.counts).toEqual({
        quotes: 2,
        orders: 3,
        parts: 1,
        communications: 2,
        notes: 2,
        attachments: 2,
      });
      expect(await recordCounts(survivor.id)).toEqual({
        quotes: 3,
        orders: 4,
        parts: 2,
        communications: 3,
        notes: 3,
        attachments: 2,
      });
      expect(await recordCounts(merged.id)).toEqual({
        quotes: 0,
        orders: 0,
        parts: 0,
        communications: 0,
        notes: 0,
        attachments: 0,
      });
    });

    it("links an Attachment already on both Customers once instead of failing", async () => {
      const survivor = await seedCustomer({ email: emailFor("merge-att-s") });
      const merged = await seedCustomer({ email: emailFor("merge-att-m") });
      await seedAttachment([survivor.id, merged.id]);
      await seedAttachment([merged.id]);

      const result = await mergeCustomers(
        { survivorId: survivor.id, mergedId: merged.id },
        admin,
      );

      expect(result.counts.attachments).toBe(1);
      expect(result.attachmentsAlreadyLinked).toBe(1);
      expect((await recordCounts(survivor.id)).attachments).toBe(2);
      expect((await recordCounts(merged.id)).attachments).toBe(0);
    });

    it("archives the merged Customer with a pointer to the survivor and keeps its emails as aliases", async () => {
      const survivorEmail = emailFor("merge-alias-s");
      const mergedEmail = emailFor("merge-alias-m");
      const extraAlias = emailFor("merge-alias-extra");
      const survivor = await seedCustomer({ email: survivorEmail });
      const merged = await seedCustomer({
        email: `  ${mergedEmail.toUpperCase()} `,
        aliases: [extraAlias],
      });

      await mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, admin);

      expect(await customerRow(merged.id)).toMatchObject({
        isArchived: true,
        mergedIntoCustomerId: survivor.id,
      });
      expect(await customerRow(survivor.id)).toMatchObject({
        isArchived: false,
        mergedIntoCustomerId: null,
      });
      expect(await aliasesOf(survivor.id)).toEqual(
        [survivorEmail, mergedEmail, extraAlias].sort(),
      );
      expect(await aliasesOf(merged.id)).toEqual([]);
    });

    it("writes one event-log entry with who merged, which Customers and counts moved", async () => {
      const survivor = await seedCustomer({ email: emailFor("merge-log-s") });
      const merged = await seedCustomer({ email: emailFor("merge-log-m") });
      await seedHistory(merged.id, { quotes: 2, notes: 1 });

      await mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, admin);

      const entries = await db
        .select()
        .from(eventLogs)
        .where(
          sql`${eventLogs.eventType} = 'customers_merged' and ${eventLogs.entityType} = 'customer' and ${eventLogs.entityId} = ${String(survivor.id)}`,
        );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId: adminId,
        userEmail: admin.email,
        metadata: expect.objectContaining({
          survivorId: survivor.id,
          mergedId: merged.id,
          counts: {
            quotes: 2,
            orders: 0,
            parts: 0,
            communications: 0,
            notes: 1,
            attachments: 0,
          },
        }),
      });
    });

    it("follows merge pointers through a chain to the final active Customer", async () => {
      const a = await seedCustomer({ email: emailFor("chain-a") });
      const b = await seedCustomer({ email: emailFor("chain-b") });
      const c = await seedCustomer({ email: emailFor("chain-c") });

      await mergeCustomers({ survivorId: b.id, mergedId: a.id }, admin);
      expect(await resolveFinalCustomerId(a.id)).toBe(b.id);

      await mergeCustomers({ survivorId: c.id, mergedId: b.id }, admin);
      expect(await resolveFinalCustomerId(a.id)).toBe(c.id);
      expect(await resolveFinalCustomerId(b.id)).toBe(c.id);
      expect(await resolveFinalCustomerId(c.id)).toBe(c.id);
      expect(await aliasesOf(c.id)).toEqual(
        [emailFor("chain-a"), emailFor("chain-b"), emailFor("chain-c")].sort(),
      );
    });

    it("does not resolve a Customer that was archived without being merged", async () => {
      const archived = await seedCustomer({ isArchived: true });

      expect(await resolveFinalCustomerId(archived.id)).toBeNull();
      expect(await resolveFinalCustomerId(2_000_000_000)).toBeNull();
    });

    describe("field resolution", () => {
      it("auto-fills blank survivor fields and addresses from the merged Customer", async () => {
        const survivor = await seedCustomer({ email: emailFor("fill-s") });
        const merged = await seedCustomer({
          email: emailFor("fill-m"),
          companyName: "Filled Co",
          contactName: "Fill Person",
          title: "Buyer",
          phone: "+15550123",
          paymentTerms: "Net 30",
          billing: { line1: "1 Main St", city: "Austin", state: "TX", postal: "78701" },
          shipping: { line1: "9 Dock Rd", city: "Dallas", state: "TX", postal: "75001" },
        });

        const preview = await previewMerge({ survivorId: survivor.id, mergedId: merged.id });
        expect(preview.conflicts).toEqual([
          expect.objectContaining({ field: "displayName" }),
          expect.objectContaining({ field: "email" }),
        ]);
        expect(preview.autoFills.map((fill) => fill.field).sort()).toEqual(
          [
            "billingAddress",
            "companyName",
            "contactName",
            "paymentTerms",
            "phone",
            "shippingAddress",
            "title",
          ].sort(),
        );

        await mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, admin);

        expect(await customerRow(survivor.id)).toMatchObject({
          companyName: "Filled Co",
          contactName: "Fill Person",
          title: "Buyer",
          phone: "+15550123",
          paymentTerms: "Net 30",
          billingAddressLine1: "1 Main St",
          billingCity: "Austin",
          shippingAddressLine1: "9 Dock Rd",
          shippingCity: "Dallas",
        });
      });

      it("keeps the survivor's value on a conflict by default and takes the merged value when chosen", async () => {
        const survivor = await seedCustomer({
          email: emailFor("conf-s"),
          displayName: `Survivor Name ${tag}`,
          companyName: "Survivor Co",
          phone: "+15550001",
        });
        const merged = await seedCustomer({
          email: emailFor("conf-m"),
          displayName: `Merged Name ${tag}`,
          companyName: "Merged Co",
          phone: "+15550002",
        });

        const preview = await previewMerge({ survivorId: survivor.id, mergedId: merged.id });
        expect(preview.conflicts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: "companyName",
              survivorValue: "Survivor Co",
              mergedValue: "Merged Co",
              requiresExplicitChoice: false,
            }),
          ]),
        );

        await mergeCustomers(
          {
            survivorId: survivor.id,
            mergedId: merged.id,
            choices: { phone: "merged", email: "merged" },
          },
          admin,
        );

        expect(await customerRow(survivor.id)).toMatchObject({
          displayName: `Survivor Name ${tag}`,
          companyName: "Survivor Co",
          phone: "+15550002",
          email: emailFor("conf-m"),
        });
      });

      it("resolves a conflicting address as one unit", async () => {
        const survivor = await seedCustomer({
          email: emailFor("addr-s"),
          billing: { line1: "1 Survivor St", city: "Austin", state: "TX", postal: "78701" },
        });
        const merged = await seedCustomer({
          email: emailFor("addr-m"),
          billing: {
            line1: "2 Merged Ave",
            line2: "Suite 5",
            city: "Boston",
            state: "MA",
            postal: "02110",
            country: "CA",
          },
        });

        await mergeCustomers(
          {
            survivorId: survivor.id,
            mergedId: merged.id,
            choices: { billingAddress: "merged" },
          },
          admin,
        );

        expect(await customerRow(survivor.id)).toMatchObject({
          billingAddressLine1: "2 Merged Ave",
          billingAddressLine2: "Suite 5",
          billingCity: "Boston",
          billingState: "MA",
          billingPostalCode: "02110",
          billingCountry: "CA",
        });
      });

      it("never lets two addresses be half-and-half when only one has a line 2", async () => {
        const survivor = await seedCustomer({
          email: emailFor("half-s"),
          billing: { line1: "1 Same St", line2: "Floor 2", city: "Austin", state: "TX", postal: "78701" },
        });
        const merged = await seedCustomer({
          email: emailFor("half-m"),
          billing: { line1: "1 Same St", city: "Austin", state: "TX", postal: "78701" },
        });

        await mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, admin);

        expect(await customerRow(survivor.id)).toMatchObject({
          billingAddressLine1: "1 Same St",
          billingAddressLine2: "Floor 2",
        });
      });

      it("refuses to merge when payment terms conflict and no explicit choice was made", async () => {
        const survivor = await seedCustomer({ email: emailFor("terms-s"), paymentTerms: "Net 30" });
        const merged = await seedCustomer({ email: emailFor("terms-m"), paymentTerms: "Net 60" });

        const preview = await previewMerge({ survivorId: survivor.id, mergedId: merged.id });
        expect(preview.conflicts).toContainEqual(
          expect.objectContaining({ field: "paymentTerms", requiresExplicitChoice: true }),
        );
        await expect(
          mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, admin),
        ).rejects.toMatchObject({ status: 400 });
        expect((await customerRow(merged.id)).isArchived).toBe(false);

        await mergeCustomers(
          {
            survivorId: survivor.id,
            mergedId: merged.id,
            choices: { paymentTerms: "merged" },
          },
          admin,
        );
        expect((await customerRow(survivor.id)).paymentTerms).toBe("Net 60");
      });
    });

    describe("previewing", () => {
      it("reports what would move and the retained emails without changing anything", async () => {
        const survivor = await seedCustomer({ email: emailFor("prev-s") });
        const merged = await seedCustomer({ email: emailFor("prev-m"), aliases: [emailFor("prev-extra")] });
        await seedHistory(merged.id, { quotes: 1, orders: 2, parts: 3, communications: 1, notes: 2 });
        await seedAttachment([survivor.id, merged.id]);
        await seedAttachment([merged.id]);

        const preview = await previewMerge({ survivorId: survivor.id, mergedId: merged.id });

        expect(preview.counts).toEqual({
          quotes: 1,
          orders: 2,
          parts: 3,
          communications: 1,
          notes: 2,
          attachments: 1,
        });
        expect(preview.attachmentsAlreadyLinked).toBe(1);
        expect(preview.retainedEmails).toEqual(
          [emailFor("prev-s"), emailFor("prev-m"), emailFor("prev-extra")].sort(),
        );
        expect((await recordCounts(merged.id)).quotes).toBe(1);
        expect((await customerRow(merged.id)).isArchived).toBe(false);
      });
    });

    describe("safety", () => {
      it("refuses to merge a Customer into itself", async () => {
        const only = await seedCustomer({ email: emailFor("self") });

        await expect(
          mergeCustomers({ survivorId: only.id, mergedId: only.id }, admin),
        ).rejects.toMatchObject({ status: 400 });
        expect((await customerRow(only.id)).isArchived).toBe(false);
      });

      it("refuses archived Customers on either side and an already-merged loser", async () => {
        const live = await seedCustomer({ email: emailFor("safe-live") });
        const archived = await seedCustomer({ email: emailFor("safe-arch"), isArchived: true });
        const mergedAway = await seedCustomer({ email: emailFor("safe-merged") });
        const target = await seedCustomer({ email: emailFor("safe-target") });
        await mergeCustomers({ survivorId: target.id, mergedId: mergedAway.id }, admin);

        await expect(
          mergeCustomers({ survivorId: live.id, mergedId: archived.id }, admin),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          mergeCustomers({ survivorId: archived.id, mergedId: live.id }, admin),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          mergeCustomers({ survivorId: live.id, mergedId: mergedAway.id }, admin),
        ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already merged/i) });
        expect((await customerRow(live.id)).isArchived).toBe(false);
      });

      it("refuses when a Customer changed after the preview was taken", async () => {
        const survivor = await seedCustomer({ email: emailFor("stale-s") });
        const merged = await seedCustomer({ email: emailFor("stale-m") });
        const preview = await previewMerge({ survivorId: survivor.id, mergedId: merged.id });

        await db
          .update(customers)
          .set({ companyName: "Changed Meanwhile", updatedAt: new Date(Date.now() + 5000) })
          .where(eq(customers.id, merged.id));

        await expect(
          mergeCustomers(
            {
              survivorId: survivor.id,
              mergedId: merged.id,
              expected: {
                survivorUpdatedAt: preview.survivorUpdatedAt,
                mergedUpdatedAt: preview.mergedUpdatedAt,
              },
            },
            admin,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect((await customerRow(merged.id)).isArchived).toBe(false);
      });

      it("only lets Admin or Dev merge, even when called directly", async () => {
        const survivor = await seedCustomer({ email: emailFor("auth-s") });
        const merged = await seedCustomer({ email: emailFor("auth-m") });

        await expect(
          mergeCustomers(
            { survivorId: survivor.id, mergedId: merged.id },
            { ...admin, role: "User" },
          ),
        ).rejects.toMatchObject({ status: 403 });
        expect((await customerRow(merged.id)).isArchived).toBe(false);
      });

      it("leaves everything untouched when any step fails", async () => {
        const survivor = await seedCustomer({ email: emailFor("atomic-s") });
        const merged = await seedCustomer({ email: emailFor("atomic-m") });
        await seedHistory(merged.id, { quotes: 2, notes: 1 });
        // The event log references users, so an unknown actor fails the very
        // last step after every record has already been moved.
        const ghostActor: MergeActor = { ...admin, userId: `ghost-${tag}` };

        await expect(
          mergeCustomers({ survivorId: survivor.id, mergedId: merged.id }, ghostActor),
        ).rejects.toThrow();

        expect(await recordCounts(merged.id)).toMatchObject({ quotes: 2, notes: 1 });
        expect(await recordCounts(survivor.id)).toMatchObject({ quotes: 0, notes: 0 });
        expect(await customerRow(merged.id)).toMatchObject({
          isArchived: false,
          mergedIntoCustomerId: null,
        });
        expect(await aliasesOf(survivor.id)).toEqual([]);
        expect(await aliasesOf(merged.id)).toEqual([]);
      });
    });
  });
});
