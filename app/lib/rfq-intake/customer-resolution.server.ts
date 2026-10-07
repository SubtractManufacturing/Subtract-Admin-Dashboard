import { and, eq, inArray, max, sql } from "drizzle-orm";

import type { db } from "../db";
import { normalizeEmail } from "../email-normalize";
import {
  customerEmailAliases,
  customers,
  orders,
  quotes,
  type Customer,
} from "../db/schema";
import type { PreparedImport } from "./types";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type IntakeContact = PreparedImport["manifest"]["contact"];

export type IntakeCustomerResolution = {
  /** The Customer the Quote attaches to. */
  customerId: number;
  /**
   * Every active Customer that matched. More than one means a human must
   * review: intake attached the Quote to one of them and created nothing.
   */
  matchedCustomerIds: number[];
};

function fullName(contact: IntakeContact): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

function displayName(contact: IntakeContact): string {
  const name = fullName(contact);
  return contact.company ? `${contact.company} - ${name}` : name;
}

async function findActiveCustomersByEmail(
  tx: DbTransaction,
  normalizedEmail: string,
): Promise<Customer[]> {
  return tx
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.isArchived, false),
        sql`(
          lower(trim(${customers.email})) = ${normalizedEmail}
          or exists (
            select 1 from ${customerEmailAliases}
            where ${customerEmailAliases.customerId} = ${customers.id}
              and ${customerEmailAliases.email} = ${normalizedEmail}
          )
        )`,
      ),
    );
}

/** The candidate with the most recent Quote or Order; ties go to the lowest id. */
async function pickMostRecentlyActive(
  tx: DbTransaction,
  candidates: Customer[],
): Promise<Customer> {
  const ids = candidates.map((customer) => customer.id);
  const [quoteActivity, orderActivity] = await Promise.all([
    tx
      .select({ customerId: quotes.customerId, latest: max(quotes.createdAt) })
      .from(quotes)
      .where(inArray(quotes.customerId, ids))
      .groupBy(quotes.customerId),
    tx
      .select({ customerId: orders.customerId, latest: max(orders.createdAt) })
      .from(orders)
      .where(inArray(orders.customerId, ids))
      .groupBy(orders.customerId),
  ]);

  const latestByCustomer = new Map<number, number>();
  for (const row of [...quoteActivity, ...orderActivity]) {
    if (row.customerId === null || row.latest === null) continue;
    const at = row.latest.getTime();
    latestByCustomer.set(
      row.customerId,
      Math.max(at, latestByCustomer.get(row.customerId) ?? at),
    );
  }

  return [...candidates].sort((a, b) => {
    const aLatest = latestByCustomer.get(a.id) ?? Number.NEGATIVE_INFINITY;
    const bLatest = latestByCustomer.get(b.id) ?? Number.NEGATIVE_INFINITY;
    if (aLatest !== bLatest) return bLatest > aLatest ? 1 : -1;
    return a.id - b.id;
  })[0];
}

/**
 * Decide which Customer an incoming RFQ belongs to. Email is the only
 * automatic signal (see ADR-0012); archived Customers never match.
 *
 * - one active match: reuse it, filling only its blank company/contact/phone
 * - no match: create a Customer and record its email as an alias
 * - several matches: attach to the most recently active one and create nothing
 */
export async function resolveIntakeCustomer(
  tx: DbTransaction,
  contact: IntakeContact,
  now: Date,
): Promise<IntakeCustomerResolution> {
  const normalizedEmail = normalizeEmail(contact.email);
  const matches = normalizedEmail
    ? await findActiveCustomersByEmail(tx, normalizedEmail)
    : [];

  if (matches.length > 1) {
    const chosen = await pickMostRecentlyActive(tx, matches);
    return {
      customerId: chosen.id,
      matchedCustomerIds: matches.map((customer) => customer.id).sort((a, b) => a - b),
    };
  }

  if (matches.length === 1) {
    const customer = matches[0];
    await tx
      .update(customers)
      .set({
        companyName: customer.companyName || contact.company,
        contactName: customer.contactName || fullName(contact),
        phone: customer.phone || contact.phone,
        updatedAt: now,
      })
      .where(eq(customers.id, customer.id));
    if (normalizedEmail) {
      await tx
        .insert(customerEmailAliases)
        .values({ customerId: customer.id, email: normalizedEmail })
        .onConflictDoNothing();
    }
    return { customerId: customer.id, matchedCustomerIds: [customer.id] };
  }

  const [created] = await tx
    .insert(customers)
    .values({
      displayName: displayName(contact),
      companyName: contact.company,
      contactName: fullName(contact),
      email: normalizedEmail ?? contact.email,
      phone: contact.phone,
    })
    .returning({ id: customers.id });
  if (normalizedEmail) {
    await tx
      .insert(customerEmailAliases)
      .values({ customerId: created.id, email: normalizedEmail });
  }
  return { customerId: created.id, matchedCustomerIds: [] };
}
