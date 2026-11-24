/**
 * Reads everything the old/new comparison needs. Call it inside a
 * REPEATABLE READ transaction so every table is read as of the same moment.
 */
import { db } from "../db";
import {
  accounts,
  addresses,
  contactEmailAliases,
  contacts,
  customerAttachments,
  customerCommunications,
  customerEmailAliases,
  customers,
  orders,
  organizationAttachments,
  organizationCommunications,
  organizationContacts,
  organizations,
  parts,
  quotes,
  vendorAttachments,
  vendors,
} from "../db/schema";
import type { Snapshot } from "./differences";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function loadSnapshot(tx: Tx): Promise<Snapshot> {
  // One statement at a time: a transaction has a single connection.
  return {
    customers: await tx.select().from(customers).orderBy(customers.id),
    vendors: await tx.select().from(vendors).orderBy(vendors.id),
    customerEmailAliases: await tx.select().from(customerEmailAliases),
    customerAttachments: await tx.select().from(customerAttachments),
    vendorAttachments: await tx.select().from(vendorAttachments),
    customerCommunications: await tx.select().from(customerCommunications),
    organizations: await tx.select().from(organizations),
    contacts: await tx.select().from(contacts),
    organizationContacts: await tx.select().from(organizationContacts),
    contactEmailAliases: await tx.select().from(contactEmailAliases),
    addresses: await tx.select().from(addresses),
    accounts: await tx.select().from(accounts),
    organizationAttachments: await tx.select().from(organizationAttachments),
    organizationCommunications: await tx.select().from(organizationCommunications),
    quotes: await tx
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerId: quotes.customerId,
        vendorId: quotes.vendorId,
        customerAccountId: quotes.customerAccountId,
        vendorAccountId: quotes.vendorAccountId,
      })
      .from(quotes)
      .orderBy(quotes.id),
    orders: await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        customerAccountId: orders.customerAccountId,
        vendorAccountId: orders.vendorAccountId,
      })
      .from(orders)
      .orderBy(orders.id),
    parts: await tx
      .select({
        id: parts.id,
        partName: parts.partName,
        customerId: parts.customerId,
        customerAccountId: parts.customerAccountId,
      })
      .from(parts),
  };
}
