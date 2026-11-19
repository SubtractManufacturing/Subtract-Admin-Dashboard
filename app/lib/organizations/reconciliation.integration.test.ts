/**
 * Integration test: the reconciliation check passes a clean backfill, blocks
 * on a broken one, and tells app edits after cutover apart.
 *
 * Requires DATABASE_URL pointing at a disposable database synced with db:push.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import {
  accounts,
  contactEmailAliases,
  legacyCustomerEmailAliases,
  legacyCustomers,
  legacyVendors,
  organizations,
  quotes,
  users,
} from "../db/schema";
import { mergeOrganizations } from "../customer-merge.server";
import { runOrganizationsBackfill } from "./backfill.server";
import { runReconciliation, type ReconciliationFinding } from "./reconciliation.server";
import { updateAccountProfile } from "./accounts.server";
import { deleteTestOrganizations } from "~/test/seed-organizations";

const tag = randomUUID().slice(0, 8);
const adminId = `recon-admin-${tag}`;
const longAgo = new Date("2024-01-01T00:00:00Z");

let customerIds: number[] = [];
let vendorId: number;
let quoteId: number;

const mine = (finding: ReconciliationFinding) =>
  (finding.legacyType === "customer" && customerIds.includes(finding.legacyId ?? -1)) ||
  (finding.legacyType === "vendor" && finding.legacyId === vendorId);

async function findings() {
  return (await runReconciliation()).findings.filter(mine);
}

async function accountFor(legacyId: number) {
  const [account] = await db.select().from(accounts).where(eq(accounts.legacyCustomerId, legacyId));
  return account;
}

beforeAll(async () => {
  await db.insert(users).values({ id: adminId, email: `${adminId}@example.test`, role: "Admin" });
  const created = await db
    .insert(legacyCustomers)
    .values([
      {
        displayName: `Recon One ${tag}`,
        companyName: `Recon One ${tag}`,
        contactName: "Rita",
        email: `rita-${tag}@recon.example`,
        billingAddressLine1: "1 Recon",
        paymentTerms: "Net 30",
        createdAt: longAgo,
        updatedAt: longAgo,
      },
      { displayName: `Recon Two ${tag}`, email: `two-${tag}@recon.example`, createdAt: longAgo, updatedAt: longAgo },
    ])
    .returning({ id: legacyCustomers.id });
  customerIds = created.map((row) => row.id);
  await db.insert(legacyCustomerEmailAliases).values({ customerId: customerIds[0], email: `rita-${tag}@recon.example` });
  const [vendor] = await db
    .insert(legacyVendors)
    .values({ displayName: `Recon Shop ${tag}`, discordId: "7", createdAt: longAgo, updatedAt: longAgo })
    .returning({ id: legacyVendors.id });
  vendorId = vendor.id;
  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber: `RQ-${tag}`,
      legacyCustomerId: customerIds[1],
      legacyVendorId: vendorId,
      createdAt: longAgo,
      updatedAt: longAgo,
    })
    .returning({ id: quotes.id });
  quoteId = quote.id;
  await runOrganizationsBackfill();
});

afterAll(async () => {
  await db.delete(quotes).where(eq(quotes.id, quoteId));
  const orgIds = (
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.legacyCustomerId, customerIds))
  ).map((row) => row.id);
  const [vendorOrg] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.legacyVendorId, vendorId));
  await deleteTestOrganizations([...orgIds, vendorOrg?.id].filter(Boolean) as string[]);
  await db.delete(legacyCustomerEmailAliases).where(inArray(legacyCustomerEmailAliases.customerId, customerIds));
  await db.delete(legacyCustomers).where(inArray(legacyCustomers.id, customerIds));
  await db.delete(legacyVendors).where(eq(legacyVendors.id, vendorId));
  await db.delete(users).where(eq(users.id, adminId));
});

describe("reconciliation", () => {
  it("finds nothing to fix after a clean backfill and records the cutover time", async () => {
    const report = await runReconciliation();
    expect(report.cutoverAt).toBeInstanceOf(Date);
    expect(report.findings.filter(mine)).toEqual([]);
    expect(report.checks.find((check) => check.name === "Quotes")?.checked).toBeGreaterThan(0);
  });

  it("blocks when a legacy link was not mapped", async () => {
    await db.update(quotes).set({ customerAccountId: null }).where(eq(quotes.id, quoteId));
    try {
      const blocking = (await runReconciliation()).findings.filter(
        (finding) => finding.check === "Quotes" && finding.detail.includes(String(quoteId)),
      );
      expect(blocking).toMatchObject([{ severity: "blocking", legacyId: customerIds[1] }]);
    } finally {
      await db
        .update(quotes)
        .set({ customerAccountId: (await accountFor(customerIds[1])).id })
        .where(eq(quotes.id, quoteId));
    }
  });

  it("blocks when a legacy alias is missing", async () => {
    const account = await accountFor(customerIds[0]);
    const contactIds = (
      await db.execute(
        // the primary Contact of the mapped Organization
        (await import("drizzle-orm")).sql`select contact_id from organization_contacts where organization_id = ${account.organizationId}`,
      )
    ) as unknown as Array<{ contact_id: string }>;
    await db.delete(contactEmailAliases).where(inArray(contactEmailAliases.contactId, contactIds.map((row) => row.contact_id)));
    const missing = (await findings()).filter((finding) => finding.check === "Email aliases");
    expect(missing).toMatchObject([{ severity: "blocking", legacyId: customerIds[0] }]);
    await db
      .insert(contactEmailAliases)
      .values({ contactId: contactIds[0].contact_id, email: `rita-${tag}@recon.example` });
  });

  it("reports edits made in the app after cutover as information, not blockers", async () => {
    const account = await accountFor(customerIds[0]);
    await updateAccountProfile("customer", account.id, { paymentTerms: "Net 45" });
    const [finding] = (await findings()).filter((f) => f.check === "Fields match");
    expect(finding).toMatchObject({ severity: "info" });
    expect(finding.detail).toContain("payment terms");
  });

  it("follows merges: a Quote moved to the survivor still reconciles", async () => {
    const one = await accountFor(customerIds[0]);
    const two = await accountFor(customerIds[1]);
    await mergeOrganizations(
      { survivorId: one.organizationId, mergedId: two.organizationId, choices: { customerPaymentTerms: "survivor" } },
      { kind: "staff", userId: adminId, email: `${adminId}@example.test`, name: null, role: "Admin" },
    );
    const remaining = (await findings()).filter((finding) => finding.severity === "blocking");
    expect(remaining).toEqual([]);
  });
});
