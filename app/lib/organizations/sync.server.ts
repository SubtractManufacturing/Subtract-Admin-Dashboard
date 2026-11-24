/**
 * Sync (ADR-0014): makes the new records equal to what the mapping gives for
 * every old Customer and Vendor row. Shadow stage only.
 *
 * - It applies exactly the list Check reports (`computeChanges`), then
 *   computes the list again and refuses to commit unless nothing fixable is
 *   left. So a Sync either leaves the copy equal to the old rows as of the
 *   moment it started, or changes nothing at all.
 * - It runs in one REPEATABLE READ transaction: every read sees the same
 *   moment, however staff use the app meanwhile.
 * - It never writes an old table. On `quotes`, `orders` and `parts` the only
 *   columns it writes are `customer_account_id` and `vendor_account_id`.
 * - It does not touch Notes, Event logs, Action Items or Customer match
 *   review metadata; those keep their integer ids until Unlock. The one Event
 *   log it writes is its own record of the run.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "../db";
import {
  accounts,
  addresses,
  contactEmailAliases,
  contacts,
  cutoverState,
  eventLogs,
  organizationAttachments,
  organizationCommunications,
  organizationContacts,
  organizations,
  type NewAccount,
  type NewAddress,
  type NewContact,
  type NewOrganization,
} from "../db/schema";
import { createEvent } from "../events";
import {
  AREA_LABELS,
  computeChanges,
  type Change,
  type ChangeSet,
  type DifferenceArea,
  type ExistingParty,
  type LinkColumn,
  type LinkTable,
  type Op,
  type PartyKey,
  type UpdatableTable,
} from "./differences";
import type { MappedAddress } from "./mapping";
import { loadSnapshot, type Tx } from "./snapshot.server";
import { CUTOVER_EVENT_ENTITY, STAGE_LABELS } from "./stage.server";

export const SYNC_RAN_EVENT = "cutover_sync_ran";

/** Serializes Sync runs. Released when the transaction ends. */
const SYNC_LOCK_KEY = "organizations-sync";

/** A normal Sync needs one pass; more means an earlier pass uncovered work. */
const MAX_PASSES = 3;

const CHUNK = 500;

export type SyncErrorCode =
  | "wrong_stage"
  | "busy"
  | "data_changed"
  | "blocked"
  | "not_converged";

/** A Sync that was refused or rolled back. Nothing was changed. */
export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export type SyncActor = { userId: string; email?: string | null };

export type SyncResult = {
  ranAt: Date;
  /** Differences removed. */
  applied: number;
  appliedByArea: Array<{ area: DifferenceArea; label: string; count: number }>;
  passes: number;
  /** Differences left that Sync does not repair by itself. */
  notFixable: number;
  oldCustomers: number;
  oldVendors: number;
};

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

type OpOf<K extends Op["kind"]> = Extract<Op, { kind: K }>;

function addressValues(
  id: string,
  organizationId: string,
  address: MappedAddress,
  createdAt: Date,
  updatedAt: Date,
): NewAddress {
  return {
    id,
    organizationId,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    isDefaultShipping: address.isDefaultShipping,
    isArchived: false,
    createdAt,
    updatedAt,
  };
}

const UPDATABLE = {
  organizations,
  contacts,
  organizationContacts,
  accounts,
  addresses,
  organizationCommunications,
} as const satisfies Record<UpdatableTable, unknown>;

const LINK_COLUMNS: Record<LinkColumn, string> = {
  customerAccountId: "customer_account_id",
  vendorAccountId: "vendor_account_id",
};

/** Apply every fixable change. The order follows the foreign keys. */
async function applyChanges(tx: Tx, changeSet: ChangeSet): Promise<void> {
  const ops = changeSet.changes.flatMap((change) =>
    change.fixable && change.op ? [change.op] : [],
  );
  const of = <K extends Op["kind"]>(kind: K) =>
    ops.filter((op): op is OpOf<K> => op.kind === kind);

  const ids = new Map<PartyKey, ExistingParty>(changeSet.parties);
  const resolve = (key: PartyKey): ExistingParty => {
    const party = ids.get(key);
    if (!party) throw new Error(`Sync has no copy for ${key}`);
    return party;
  };

  // 1. Copies that do not exist yet. Ids are assigned here, once; later runs
  //    find the copy by its legacy id and never assign another.
  const organizationRows: NewOrganization[] = [];
  const contactRows: NewContact[] = [];
  const linkRows: Array<typeof organizationContacts.$inferInsert> = [];
  const addressRows: NewAddress[] = [];
  const accountRows: NewAccount[] = [];
  for (const op of of("createParty")) {
    const { mapped, updatedAt } = op;
    const organizationId = randomUUID();
    const contactId = randomUUID();
    const accountId = randomUUID();
    const createdAt = mapped.organization.createdAt;
    const isCustomer = op.legacyType === "customer";
    organizationRows.push({
      id: organizationId,
      kind: mapped.organization.kind,
      name: mapped.organization.name,
      legacyCustomerId: isCustomer ? op.legacyId : null,
      legacyVendorId: isCustomer ? null : op.legacyId,
      isArchived: mapped.organization.isArchived,
      createdAt,
      updatedAt,
    });
    contactRows.push({ id: contactId, ...mapped.contact, updatedAt });
    linkRows.push({
      organizationId,
      contactId,
      isPrimary: true,
      isArchived: false,
      role: null,
      createdAt,
      updatedAt,
    });
    let billingAddressId: string | null = null;
    if (mapped.billingAddress) {
      billingAddressId = randomUUID();
      addressRows.push(
        addressValues(billingAddressId, organizationId, mapped.billingAddress, createdAt, updatedAt),
      );
    }
    if (mapped.shippingAddress) {
      addressRows.push(
        addressValues(randomUUID(), organizationId, mapped.shippingAddress, createdAt, updatedAt),
      );
    }
    accountRows.push({
      id: accountId,
      organizationId,
      type: mapped.account.type,
      paymentTerms: mapped.account.paymentTerms,
      billingAddressId,
      discordId: mapped.account.discordId,
      legacyAddress: mapped.account.legacyAddress,
      notes: mapped.account.notes,
      legacyCustomerId: isCustomer ? op.legacyId : null,
      legacyVendorId: isCustomer ? null : op.legacyId,
      isArchived: mapped.account.isArchived,
      createdAt: mapped.account.createdAt,
      updatedAt,
    });
    ids.set(op.party, { organizationId, accountId, contactId });
  }
  for (const rows of chunks(organizationRows)) await tx.insert(organizations).values(rows);
  for (const rows of chunks(contactRows)) await tx.insert(contacts).values(rows);
  for (const rows of chunks(linkRows)) await tx.insert(organizationContacts).values(rows);
  for (const rows of chunks(addressRows)) await tx.insert(addresses).values(rows);
  for (const rows of chunks(accountRows)) await tx.insert(accounts).values(rows);

  // 2. A copy that lost its Contact.
  for (const op of of("createContact")) {
    const contactId = randomUUID();
    await tx.insert(contacts).values({ id: contactId, ...op.contact, updatedAt: op.updatedAt });
    await tx.insert(organizationContacts).values({
      organizationId: op.organizationId,
      contactId,
      isPrimary: true,
      isArchived: false,
      role: null,
      createdAt: op.contact.createdAt,
      updatedAt: op.updatedAt,
    });
    ids.set(op.party, { ...resolve(op.party), contactId });
  }

  // 3. Addresses the old row gained.
  for (const op of of("createAddress")) {
    const addressId = randomUUID();
    await tx
      .insert(addresses)
      .values(addressValues(addressId, op.organizationId, op.address, op.createdAt, op.updatedAt));
    if (op.role === "billing") {
      await tx
        .update(accounts)
        .set({ billingAddressId: addressId, updatedAt: op.updatedAt })
        .where(eq(accounts.id, op.accountId));
    }
  }

  // 4. Field by field, one statement per record.
  const updates = new Map<string, { table: UpdatableTable; id: string; set: Record<string, unknown>; touchedAt: Date | null }>();
  for (const op of of("update")) {
    const key = `${op.table}:${op.id}`;
    const entry = updates.get(key) ?? { table: op.table, id: op.id, set: {}, touchedAt: null };
    Object.assign(entry.set, op.set);
    entry.touchedAt = op.touchedAt ?? entry.touchedAt;
    updates.set(key, entry);
  }
  for (const { table, id, set, touchedAt } of updates.values()) {
    const target = UPDATABLE[table];
    const values = touchedAt && "updatedAt" in target ? { ...set, updatedAt: touchedAt } : set;
    await tx.update(target).set(values).where(eq(target.id, id));
  }

  // 5. Addresses the old row no longer has.
  for (const op of of("deleteAddress")) {
    await tx
      .update(accounts)
      .set({ billingAddressId: null })
      .where(eq(accounts.billingAddressId, op.addressId));
    await tx.delete(addresses).where(eq(addresses.id, op.addressId));
  }

  // 6. Aliases.
  const aliasRows = of("addAlias").map((op) => {
    const contactId = resolve(op.party).contactId;
    if (!contactId) throw new Error(`Sync has no Contact for ${op.party}`);
    return { contactId, email: op.email, createdAt: op.createdAt };
  });
  for (const rows of chunks(aliasRows)) await tx.insert(contactEmailAliases).values(rows);
  for (const op of of("removeAlias")) {
    await tx
      .delete(contactEmailAliases)
      .where(
        and(
          eq(contactEmailAliases.contactId, op.contactId),
          eq(contactEmailAliases.email, op.email),
        ),
      );
  }

  // 7. Files.
  const fileRows = of("addFile").map((op) => ({
    organizationId: resolve(op.party).organizationId,
    attachmentId: op.attachmentId,
    createdAt: op.createdAt,
  }));
  for (const rows of chunks(fileRows)) await tx.insert(organizationAttachments).values(rows);
  for (const op of of("removeFile")) {
    await tx
      .delete(organizationAttachments)
      .where(
        and(
          eq(organizationAttachments.organizationId, op.organizationId),
          eq(organizationAttachments.attachmentId, op.attachmentId),
        ),
      );
  }

  // 8. Communications keep their id.
  const communicationRows = of("addCommunication").map((op) => ({
    ...op.row,
    organizationId: resolve(op.party).organizationId,
    contactId: null,
  }));
  for (const rows of chunks(communicationRows)) {
    await tx.insert(organizationCommunications).values(rows);
  }
  for (const op of of("moveCommunication")) {
    await tx
      .update(organizationCommunications)
      .set({ organizationId: resolve(op.party).organizationId })
      .where(eq(organizationCommunications.id, op.id));
  }
  for (const idsToRemove of chunks(of("removeCommunication").map((op) => op.id))) {
    await tx
      .delete(organizationCommunications)
      .where(inArray(organizationCommunications.id, idsToRemove));
  }

  // 9. Merge pointers, set and cleared to match.
  for (const op of of("setMergePointer")) {
    await tx
      .update(organizations)
      .set({
        mergedIntoOrganizationId: op.target ? resolve(op.target).organizationId : null,
      })
      .where(eq(organizations.id, resolve(op.party).organizationId));
  }

  // 10. Quote, Order and Part links. Only the account column is written.
  const links = new Map<string, { table: LinkTable; column: LinkColumn; rows: Array<{ id: number | string; accountId: string | null }> }>();
  for (const op of of("setLink")) {
    const key = `${op.table}:${op.column}`;
    const group = links.get(key) ?? { table: op.table, column: op.column, rows: [] };
    group.rows.push({ id: op.id, accountId: op.target ? resolve(op.target).accountId : null });
    links.set(key, group);
  }
  // Take every row lock first, without waiting. Staff may be saving one of
  // these Quotes, Orders or Parts (the Customer merge updates many at once);
  // a Sync that waited for some rows while holding others could deadlock with
  // them, and Postgres might then abort the staff member's save. Refusing
  // here aborts this Sync instead, before it has waited for anything.
  const idsByTable = new Map<LinkTable, Set<number | string>>();
  for (const { table, rows } of links.values()) {
    const ids = idsByTable.get(table) ?? new Set<number | string>();
    for (const linkRow of rows) ids.add(linkRow.id);
    idsByTable.set(table, ids);
  }
  for (const [table, ids] of idsByTable) {
    const idType = table === "parts" ? sql.raw("uuid") : sql.raw("integer");
    for (const part of chunks([...ids])) {
      await tx.execute(sql`
        select id from ${sql.identifier(table)}
        where id in (${sql.join(part.map((id) => sql`${id}::${idType}`), sql`, `)})
        order by id
        for no key update nowait
      `);
    }
  }
  for (const { table, column, rows } of links.values()) {
    const idType = table === "parts" ? sql.raw("uuid") : sql.raw("integer");
    for (const part of chunks(rows)) {
      await tx.execute(sql`
        update ${sql.identifier(table)} as t
        set ${sql.identifier(LINK_COLUMNS[column])} = v.account_id
        from (values ${sql.join(
          part.map((row) => sql`(${row.id}::${idType}, ${row.accountId}::uuid)`),
          sql`, `,
        )}) as v(id, account_id)
        where t.id = v.id
      `);
    }
  }

  // 11. Copies of old rows that no longer exist. Last, so nothing points at them.
  for (const op of of("deleteCopy")) {
    const id = op.organizationId;
    await tx.delete(organizationAttachments).where(eq(organizationAttachments.organizationId, id));
    await tx.delete(organizationCommunications).where(eq(organizationCommunications.organizationId, id));
    await tx
      .update(organizations)
      .set({ mergedIntoOrganizationId: null })
      .where(eq(organizations.mergedIntoOrganizationId, id));
    await tx.delete(accounts).where(eq(accounts.organizationId, id));
    await tx.delete(addresses).where(eq(addresses.organizationId, id));
    const linked = await tx
      .delete(organizationContacts)
      .where(eq(organizationContacts.organizationId, id))
      .returning({ contactId: organizationContacts.contactId });
    for (const { contactId } of linked) {
      const [elsewhere] = await tx
        .select({ id: organizationContacts.id })
        .from(organizationContacts)
        .where(eq(organizationContacts.contactId, contactId))
        .limit(1);
      if (elsewhere) continue;
      await tx.delete(contactEmailAliases).where(eq(contactEmailAliases.contactId, contactId));
      await tx
        .update(contacts)
        .set({ mergedIntoContactId: null })
        .where(eq(contacts.mergedIntoContactId, contactId));
      await tx.delete(contacts).where(eq(contacts.id, contactId));
    }
    await tx.delete(organizations).where(eq(organizations.id, id));
  }
}

function countByArea(changes: Change[]) {
  const counts = new Map<DifferenceArea, number>();
  for (const change of changes) counts.set(change.area, (counts.get(change.area) ?? 0) + 1);
  return (Object.keys(AREA_LABELS) as DifferenceArea[])
    .filter((area) => counts.has(area))
    .map((area) => ({ area, label: AREA_LABELS[area], count: counts.get(area)! }));
}

/** Postgres codes for "someone else changed or holds a row this Sync needs". */
const CONCURRENCY_CODES = new Set(["40001", "40P01", "55P03"]);
/** Foreign-key and unique violations: a record Sync did not expect is in the way. */
const CONSTRAINT_CODES = new Set(["23503", "23505"]);

function postgresError(error: unknown): { code?: string; constraint?: string } {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    const { code, constraint_name: constraint } = (candidate ?? {}) as {
      code?: unknown;
      constraint_name?: unknown;
    };
    if (typeof code === "string") {
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
  }
  return {};
}

/**
 * Run Sync. Throws {@link SyncError} when it is refused or rolled back; in
 * every such case nothing was changed.
 */
export async function runSync(actor: SyncActor): Promise<SyncResult> {
  try {
    return await db.transaction(
      async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtext(${SYNC_LOCK_KEY})) as acquired`,
        );
        if (!lock?.acquired) {
          throw new SyncError("busy", "Another Sync is running. Wait for it to finish.");
        }
        // Give way to staff: if a row this Sync needs is held for long, stop
        // (and change nothing) before Postgres has to break a deadlock.
        await tx.execute(sql`set local lock_timeout = '800ms'`);

        // Holding the stage row keeps the stage from changing mid-Sync.
        const [state] = await tx
          .select()
          .from(cutoverState)
          .where(eq(cutoverState.id, 1))
          .for("share");
        if (!state) {
          throw new SyncError(
            "wrong_stage",
            "The cutover stage has not been recorded yet, so Sync will not run.",
          );
        }
        if (state.stage !== "shadow") {
          throw new SyncError(
            "wrong_stage",
            `Sync runs in Shadow only. The stage is ${STAGE_LABELS[state.stage]}; a Sync now would overwrite the live tables.`,
          );
        }

        const applied: Change[] = [];
        let changeSet = computeChanges(await loadSnapshot(tx));
        let passes = 0;
        while (changeSet.changes.some((change) => change.fixable)) {
          if (passes === MAX_PASSES) {
            const left = changeSet.changes.filter((change) => change.fixable);
            throw new SyncError(
              "not_converged",
              `Sync could not make old and new equal (${left.length} differences left, for example: ${left[0].detail}). Nothing was changed.`,
            );
          }
          passes += 1;
          applied.push(...changeSet.changes.filter((change) => change.fixable));
          await applyChanges(tx, changeSet);
          changeSet = computeChanges(await loadSnapshot(tx));
        }

        const result: SyncResult = {
          ranAt: new Date(),
          applied: applied.length,
          appliedByArea: countByArea(applied),
          passes,
          notFixable: changeSet.changes.length,
          oldCustomers: changeSet.counts.customers,
          oldVendors: changeSet.counts.vendors,
        };
        await createEvent(
          {
            ...CUTOVER_EVENT_ENTITY,
            eventType: SYNC_RAN_EVENT,
            eventCategory: "system",
            title: "Cutover Sync ran",
            description:
              result.applied === 0
                ? "Old and new were already equal; nothing was changed."
                : `Sync removed ${result.applied} differences between the old tables and their copy.`,
            metadata: {
              applied: result.applied,
              appliedByArea: Object.fromEntries(
                result.appliedByArea.map(({ area, count }) => [area, count]),
              ),
              passes: result.passes,
              notFixable: result.notFixable,
              oldCustomers: result.oldCustomers,
              oldVendors: result.oldVendors,
            },
            userId: actor.userId,
            userEmail: actor.email ?? undefined,
          },
          tx,
        );
        return result;
      },
      { isolationLevel: "repeatable read" },
    );
  } catch (error) {
    if (error instanceof SyncError) throw error;
    const { code, constraint } = postgresError(error);
    if (code && CONCURRENCY_CODES.has(code)) {
      throw new SyncError(
        "data_changed",
        "Someone was changing a record Sync needed. Nothing was changed; run Sync again.",
      );
    }
    if (code && CONSTRAINT_CODES.has(code)) {
      throw new SyncError(
        "blocked",
        `Sync ran into a record it did not expect${constraint ? ` (${constraint})` : ""}. Nothing was changed; a developer has to look.`,
      );
    }
    throw error;
  }
}

export type LastSync = {
  ranAt: Date;
  userEmail: string | null;
  applied: number;
  notFixable: number;
};

/** The most recent Sync, from its Event log. */
export async function getLastSync(): Promise<LastSync | null> {
  const [event] = await db
    .select()
    .from(eventLogs)
    .where(
      and(
        eq(eventLogs.entityType, CUTOVER_EVENT_ENTITY.entityType),
        eq(eventLogs.entityId, CUTOVER_EVENT_ENTITY.entityId),
        eq(eventLogs.eventType, SYNC_RAN_EVENT),
        // Sync always records who ran it; an entry without a user is not one of its own.
        isNotNull(eventLogs.userId),
      ),
    )
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);
  if (!event) return null;
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  return {
    ranAt: event.createdAt,
    userEmail: event.userEmail,
    applied: Number(metadata.applied ?? 0),
    notFixable: Number(metadata.notFixable ?? 0),
  };
}
