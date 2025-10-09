import { db } from "./db";
import { eventLogs, type EventLog as EventLogSchema, type NewEventLog } from "./db/schema";
import { eq, and, desc, gte, lte, or, like, sql } from "drizzle-orm";

export type EventLog = EventLogSchema;

export interface EventLogInput {
  entityType: string;
  entityId: string;
  eventType: string;
  eventCategory: "status" | "document" | "financial" | "communication" | "system" | "quality" | "manufacturing";
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface EventFilters {
  entityType?: string;
  entityId?: string;
  eventCategory?: string;
  startDate?: Date;
  endDate?: Date;
  searchTerm?: string;
  limit?: number;
  offset?: number;
  sortOrder?: "asc" | "desc";
  dismissedOnly?: boolean;
}

export async function createEvent(eventData: EventLogInput): Promise<EventLog> {
  const newEvent: NewEventLog = {
    ...eventData,
  };

  const [event] = await db.insert(eventLogs).values(newEvent).returning();
  return event;
}

export async function dismissEvent(eventId: string, dismissedBy: string): Promise<EventLog | null> {
  const result = await db
    .update(eventLogs)
    .set({
      isDismissed: true,
      dismissedAt: new Date(),
      dismissedBy,
    })
    .where(eq(eventLogs.id, eventId))
    .returning();

  return result[0] || null;
}

export async function restoreEvent(eventId: string): Promise<EventLog | null> {
  const result = await db
    .update(eventLogs)
    .set({
      isDismissed: false,
      dismissedAt: null,
      dismissedBy: null,
    })
    .where(eq(eventLogs.id, eventId))
    .returning();

  return result[0] || null;
}

export async function getEventsByEntity(
  entityType: string,
  entityId: string,
  limit = 10
): Promise<EventLog[]> {
  return await db
    .select()
    .from(eventLogs)
    .where(and(
      eq(eventLogs.entityType, entityType),
      eq(eventLogs.entityId, entityId),
      eq(eventLogs.isDismissed, false)
    ))
    .orderBy(desc(eventLogs.createdAt))
    .limit(limit);
}

export async function getEventsForOrder(
  orderId: number,
  limit = 10
): Promise<EventLog[]> {
  // Get both direct order events and part events related to this order
  return await db
    .select()
    .from(eventLogs)
    .where(and(
      or(
        // Direct order events
        and(
          eq(eventLogs.entityType, "order"),
          eq(eventLogs.entityId, orderId.toString())
        ),
        // Part events that reference this order in metadata
        and(
          eq(eventLogs.entityType, "part"),
          sql`${eventLogs.metadata}->>'orderId' = ${orderId.toString()}`
        )
      ),
      eq(eventLogs.isDismissed, false)
    ))
    .orderBy(desc(eventLogs.createdAt))
    .limit(limit);
}

export async function getRecentEvents(filters: EventFilters = {}): Promise<{
  events: EventLog[];
  totalCount: number;
}> {
  const conditions = [];

  // Filter for dismissed events if requested
  if (filters.dismissedOnly) {
    conditions.push(eq(eventLogs.isDismissed, true));
  }

  if (filters.entityType) {
    conditions.push(eq(eventLogs.entityType, filters.entityType));
  }

  if (filters.entityId) {
    conditions.push(eq(eventLogs.entityId, filters.entityId));
  }

  if (filters.eventCategory) {
    conditions.push(eq(eventLogs.eventCategory, filters.eventCategory as "status" | "document" | "financial" | "communication" | "system" | "quality" | "manufacturing"));
  }


  if (filters.startDate) {
    conditions.push(gte(eventLogs.createdAt, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(eventLogs.createdAt, filters.endDate));
  }

  if (filters.searchTerm) {
    conditions.push(
      or(
        like(eventLogs.title, `%${filters.searchTerm}%`),
        like(eventLogs.description, `%${filters.searchTerm}%`),
        like(eventLogs.entityId, `%${filters.searchTerm}%`)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventLogs)
    .where(where);

  const totalCount = countResult[0]?.count ?? 0;

  // Get paginated events
  const query = db.select().from(eventLogs).where(where);

  if (filters.sortOrder === "asc") {
    query.orderBy(eventLogs.createdAt);
  } else {
    query.orderBy(desc(eventLogs.createdAt));
  }

  if (filters.limit) {
    query.limit(filters.limit);
  }

  if (filters.offset) {
    query.offset(filters.offset);
  }

  const events = await query;

  return { events, totalCount };
}

export async function getEventById(id: string): Promise<EventLog | null> {
  const [event] = await db
    .select()
    .from(eventLogs)
    .where(eq(eventLogs.id, id))
    .limit(1);

  return event || null;
}

export async function getEventStats(entityType?: string): Promise<{
  totalEvents: number;
  eventsByCategory: Record<string, number>;
}> {
  const conditions = entityType ? [eq(eventLogs.entityType, entityType)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total events
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventLogs)
    .where(where);

  const totalEvents = totalResult[0]?.count ?? 0;

  // Get events by category
  const categoryResult = await db
    .select({
      category: eventLogs.eventCategory,
      count: sql<number>`count(*)::int`,
    })
    .from(eventLogs)
    .where(where)
    .groupBy(eventLogs.eventCategory);

  const eventsByCategory = categoryResult.reduce(
    (acc, row) => ({
      ...acc,
      [row.category]: row.count,
    }),
    {} as Record<string, number>
  );


  return {
    totalEvents,
    eventsByCategory,
  };
}

export async function deleteOldEvents(daysToKeep = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await db
    .delete(eventLogs)
    .where(lte(eventLogs.createdAt, cutoffDate));

  return result.length || 0;
}

export async function createBatchEvents(events: EventLogInput[]): Promise<EventLog[]> {
  if (events.length === 0) return [];

  const newEvents: NewEventLog[] = events.map(event => ({
    ...event,
  }));

  return await db.insert(eventLogs).values(newEvents).returning();
}