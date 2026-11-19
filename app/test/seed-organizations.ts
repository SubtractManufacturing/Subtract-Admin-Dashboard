/**
 * Integration test helpers for the ADR-0013 model: create Customers and
 * Vendors through the real data layer, and remove every row they own.
 */
import { inArray, or, sql } from "drizzle-orm";

import { db } from "~/lib/db";
import {
  accounts,
  addresses,
  contactEmailAliases,
  contacts,
  eventLogs,
  notes,
  organizationAttachments,
  organizationCommunications,
  organizationContacts,
  organizations,
} from "~/lib/db/schema";
import { createAccount } from "~/lib/organizations/accounts.server";
import type { AccountProfileInput, VendorRecord } from "~/lib/organizations/types";

export async function createTestCustomer(
  input: AccountProfileInput,
  options: { organizationId?: string; now?: Date } = {},
): Promise<VendorRecord> {
  return createAccount("customer", input, options);
}

export async function createTestVendor(
  input: AccountProfileInput,
  options: { organizationId?: string; now?: Date } = {},
): Promise<VendorRecord> {
  return createAccount("vendor", input, options);
}

/**
 * Delete Organizations and everything hanging off them: accounts, Contacts
 * (and their aliases), addresses, file links, communications, and Notes and
 * Event logs on their accounts. Quotes, Orders and Parts must be removed by
 * the caller first.
 */
export async function deleteTestOrganizations(organizationIds: string[]): Promise<void> {
  const ids = [...new Set(organizationIds.filter(Boolean))];
  if (ids.length === 0) return;
  const accountIds = (
    await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.organizationId, ids))
  ).map((row) => row.id);
  const contactIds = (
    await db
      .select({ id: organizationContacts.contactId })
      .from(organizationContacts)
      .where(inArray(organizationContacts.organizationId, ids))
  ).map((row) => row.id);

  if (accountIds.length > 0) {
    await db
      .delete(notes)
      .where(sql`${notes.entityType} in ('customer', 'vendor') and ${inArray(notes.entityId, accountIds)}`);
    await db
      .delete(eventLogs)
      .where(sql`${eventLogs.entityType} in ('customer', 'vendor') and ${inArray(eventLogs.entityId, accountIds)}`);
  }
  await db.delete(organizationCommunications).where(inArray(organizationCommunications.organizationId, ids));
  await db.delete(organizationAttachments).where(inArray(organizationAttachments.organizationId, ids));
  await db.update(accounts).set({ billingAddressId: null }).where(inArray(accounts.organizationId, ids));
  await db.delete(accounts).where(inArray(accounts.organizationId, ids));
  await db.delete(addresses).where(inArray(addresses.organizationId, ids));
  await db.delete(organizationContacts).where(inArray(organizationContacts.organizationId, ids));
  if (contactIds.length > 0) {
    // Only Contacts no longer linked anywhere else.
    const stillLinked = new Set(
      (
        await db
          .select({ id: organizationContacts.contactId })
          .from(organizationContacts)
          .where(inArray(organizationContacts.contactId, contactIds))
      ).map((row) => row.id),
    );
    const orphaned = contactIds.filter((id) => !stillLinked.has(id));
    if (orphaned.length > 0) {
      await db.delete(organizationCommunications).where(inArray(organizationCommunications.contactId, orphaned));
      await db.delete(contactEmailAliases).where(inArray(contactEmailAliases.contactId, orphaned));
      await db
        .update(contacts)
        .set({ mergedIntoContactId: null })
        .where(inArray(contacts.mergedIntoContactId, orphaned));
      await db.delete(contacts).where(inArray(contacts.id, orphaned));
    }
  }
  await db
    .update(organizations)
    .set({ mergedIntoOrganizationId: null })
    .where(or(inArray(organizations.mergedIntoOrganizationId, ids), inArray(organizations.id, ids)));
  await db.delete(organizations).where(inArray(organizations.id, ids));
}
