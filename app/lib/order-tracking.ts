import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  orderTrackingNumbers,
  type NewOrderTrackingNumber,
  type OrderTrackingNumber,
} from "./db/schema.js";
import { createEvent } from "./events.js";
import type { OrderEventContext } from "./orders.js";

export type TrackingEntry = {
  trackingNumber: string;
  carrier?: string | null;
  carrierDetails?: { name: string } | null;
};

export type TrackingNumberUpdate = {
  id: number;
  trackingNumber: string;
  carrier?: string | null;
  carrierDetails?: { name: string } | null;
};

function normalizeEntries(entries: TrackingEntry[]): TrackingEntry[] {
  const seen = new Set<string>();
  const normalized: TrackingEntry[] = [];

  for (const entry of entries) {
    const trackingNumber = entry.trackingNumber.trim();
    if (!trackingNumber || seen.has(trackingNumber)) continue;

    seen.add(trackingNumber);
    normalized.push({
      trackingNumber,
      carrier: entry.carrier ?? null,
      carrierDetails: entry.carrierDetails ?? null,
    });
  }

  return normalized;
}

export async function getTrackingNumbersByOrderId(
  orderId: number,
): Promise<OrderTrackingNumber[]> {
  return await db
    .select()
    .from(orderTrackingNumbers)
    .where(eq(orderTrackingNumbers.orderId, orderId))
    .orderBy(asc(orderTrackingNumbers.createdAt));
}

export async function addTrackingNumbers(
  orderId: number,
  entries: TrackingEntry[],
  eventContext?: OrderEventContext,
): Promise<OrderTrackingNumber[]> {
  const normalizedEntries = normalizeEntries(entries);
  if (normalizedEntries.length === 0) return [];

  const existingNumbers = await getTrackingNumbersByOrderId(orderId);
  const existingSet = new Set(
    existingNumbers.map((row) => row.trackingNumber),
  );
  const duplicates = normalizedEntries
    .map((e) => e.trackingNumber)
    .filter((number) => existingSet.has(number));

  if (duplicates.length > 0) {
    throw new Error(
      `Tracking number already exists on this order: ${duplicates.join(", ")}`,
    );
  }

  const values: NewOrderTrackingNumber[] = normalizedEntries.map((entry) => ({
    orderId,
    trackingNumber: entry.trackingNumber,
    carrier: entry.carrier ?? null,
    carrierDetails: entry.carrierDetails ?? null,
  }));

  const inserted = await db
    .insert(orderTrackingNumbers)
    .values(values)
    .returning();

  await createEvent({
    entityType: "order",
    entityId: orderId.toString(),
    eventType: "tracking_numbers_added",
    eventCategory: "status",
    title: "Tracking number added",
    description:
      normalizedEntries.length === 1
        ? `Added tracking number ${normalizedEntries[0].trackingNumber}`
        : `Added ${normalizedEntries.length} tracking numbers`,
    metadata: {
      trackingNumbers: normalizedEntries.map((e) => ({
        trackingNumber: e.trackingNumber,
        carrier: e.carrier ?? null,
        carrierDetails: e.carrierDetails ?? null,
      })),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return inserted;
}

export async function deleteTrackingNumbers(
  orderId: number,
  ids: number[],
  eventContext?: OrderEventContext,
): Promise<OrderTrackingNumber[]> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
  if (uniqueIds.length === 0) return [];

  const ownedRows = await db
    .select()
    .from(orderTrackingNumbers)
    .where(
      and(
        eq(orderTrackingNumbers.orderId, orderId),
        inArray(orderTrackingNumbers.id, uniqueIds),
      ),
    )
    .orderBy(asc(orderTrackingNumbers.createdAt));

  if (ownedRows.length !== uniqueIds.length) {
    throw new Error("One or more tracking numbers do not belong to this order");
  }

  const deleted = await db
    .delete(orderTrackingNumbers)
    .where(
      and(
        eq(orderTrackingNumbers.orderId, orderId),
        inArray(orderTrackingNumbers.id, uniqueIds),
      ),
    )
    .returning();

  await createEvent({
    entityType: "order",
    entityId: orderId.toString(),
    eventType: "tracking_numbers_deleted",
    eventCategory: "status",
    title: "Tracking number deleted",
    description:
      deleted.length === 1
        ? `Deleted tracking number ${deleted[0].trackingNumber}`
        : `Deleted ${deleted.length} tracking numbers`,
    metadata: {
      deletedIds: uniqueIds,
      trackingNumbers: deleted.map((row) => ({
        trackingNumber: row.trackingNumber,
        carrier: row.carrier ?? null,
        carrierDetails: row.carrierDetails ?? null,
      })),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return deleted;
}

export async function updateTrackingNumbers(
  orderId: number,
  updates: TrackingNumberUpdate[],
  eventContext?: OrderEventContext,
): Promise<OrderTrackingNumber[]> {
  const normalized = updates
    .map((update) => ({
      id: update.id,
      trackingNumber: update.trackingNumber.trim(),
      carrier: update.carrier ?? null,
      carrierDetails: update.carrierDetails ?? null,
    }))
    .filter((update) => Number.isFinite(update.id) && update.trackingNumber);

  if (normalized.length === 0) return [];

  const uniqueIds = Array.from(new Set(normalized.map((update) => update.id)));
  if (uniqueIds.length !== normalized.length) {
    throw new Error("Duplicate tracking number ids in update payload");
  }

  const ownedRows = await db
    .select()
    .from(orderTrackingNumbers)
    .where(
      and(
        eq(orderTrackingNumbers.orderId, orderId),
        inArray(orderTrackingNumbers.id, uniqueIds),
      ),
    )
    .orderBy(asc(orderTrackingNumbers.createdAt));

  if (ownedRows.length !== uniqueIds.length) {
    throw new Error("One or more tracking numbers do not belong to this order");
  }

  const ownedById = new Map(ownedRows.map((row) => [row.id, row]));

  // Snapshot previous state before mutations so audit metadata is accurate
  const previousById = new Map(
    ownedRows.map((row) => [
      row.id,
      {
        trackingNumber: row.trackingNumber,
        carrier: row.carrier ?? null,
        carrierDetails: row.carrierDetails ?? null,
      },
    ]),
  );

  const changed = normalized.filter((update) => {
    const owned = ownedById.get(update.id);
    if (!owned) return false;
    const trackingChanged = owned.trackingNumber !== update.trackingNumber;
    const carrierChanged = owned.carrier !== update.carrier;
    const carrierDetailsChanged =
      JSON.stringify(owned.carrierDetails) !==
      JSON.stringify(update.carrierDetails);
    return trackingChanged || carrierChanged || carrierDetailsChanged;
  });

  if (changed.length === 0) return [];

  const changedIds = new Set(changed.map((update) => update.id));
  const untouched = await getTrackingNumbersByOrderId(orderId);
  const existingValues = new Set(
    untouched
      .filter((row) => !changedIds.has(row.id))
      .map((row) => row.trackingNumber),
  );

  const newValueCounts = new Map<string, number>();
  for (const update of changed) {
    newValueCounts.set(
      update.trackingNumber,
      (newValueCounts.get(update.trackingNumber) ?? 0) + 1,
    );
  }
  const duplicates = changed.filter((update) => {
    const count = newValueCounts.get(update.trackingNumber) ?? 0;
    return count > 1 || existingValues.has(update.trackingNumber);
  });
  if (duplicates.length > 0) {
    throw new Error(
      `Tracking number already exists on this order: ${duplicates
        .map((update) => update.trackingNumber)
        .join(", ")}`,
    );
  }

  const updated: OrderTrackingNumber[] = [];
  for (const update of changed) {
    const [row] = await db
      .update(orderTrackingNumbers)
      .set({
        trackingNumber: update.trackingNumber,
        carrier: update.carrier,
        carrierDetails: update.carrierDetails,
      })
      .where(
        and(
          eq(orderTrackingNumbers.orderId, orderId),
          eq(orderTrackingNumbers.id, update.id),
        ),
      )
      .returning();
    if (row) updated.push(row);
  }

  await createEvent({
    entityType: "order",
    entityId: orderId.toString(),
    eventType: "tracking_numbers_updated",
    eventCategory: "status",
    title: "Tracking number updated",
    description:
      updated.length === 1
        ? `Updated tracking number to ${updated[0].trackingNumber}`
        : `Updated ${updated.length} tracking numbers`,
    metadata: {
      updates: changed.map((update) => {
        const previous = previousById.get(update.id);
        return {
          id: update.id,
          previous: {
            trackingNumber: previous?.trackingNumber ?? null,
            carrier: previous?.carrier ?? null,
            carrierDetails: previous?.carrierDetails ?? null,
          },
          next: {
            trackingNumber: update.trackingNumber,
            carrier: update.carrier,
            carrierDetails: update.carrierDetails,
          },
        };
      }),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return updated;
}

export async function hasTrackingNumbers(orderId: number): Promise<boolean> {
  const trackingNumbers = await getTrackingNumbersByOrderId(orderId);
  return trackingNumbers.length > 0;
}
