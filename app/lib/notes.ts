import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import { notes, type Note, type NewNote } from "./db/schema";

export async function getNotes(entityType: string, entityId: string): Promise<Note[]> {
  const result = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.entityType, entityType),
        eq(notes.entityId, entityId),
        eq(notes.isArchived, false)
      )
    )
    .orderBy(desc(notes.createdAt));
  
  return result;
}

export async function createNote(data: Omit<NewNote, "id" | "createdAt" | "updatedAt">): Promise<Note> {
  const [newNote] = await db
    .insert(notes)
    .values({
      ...data,
      updatedAt: new Date(),
    })
    .returning();
  
  return newNote;
}

export async function updateNote(id: string, content: string): Promise<Note> {
  const [updatedNote] = await db
    .update(notes)
    .set({
      content,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, id))
    .returning();
  
  return updatedNote;
}

export async function archiveNote(id: string): Promise<Note> {
  const [archivedNote] = await db
    .update(notes)
    .set({
      isArchived: true,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, id))
    .returning();
  
  return archivedNote;
}

export async function validateEntityExists(entityType: string, entityId: string): Promise<boolean> {
  const allowedTypes = ["order", "customer", "vendor", "quote", "part"];
  
  if (!allowedTypes.includes(entityType)) {
    return false;
  }
  
  try {
    let exists = false;
    
    switch (entityType) {
      case "order": {
        const { orders } = await import("./db/schema");
        const order = await db
          .select()
          .from(orders)
          .where(eq(orders.id, parseInt(entityId)))
          .limit(1);
        exists = order.length > 0;
        break;
      }
        
      case "customer": {
        const { customers } = await import("./db/schema");
        const customer = await db
          .select()
          .from(customers)
          .where(eq(customers.id, parseInt(entityId)))
          .limit(1);
        exists = customer.length > 0;
        break;
      }
        
      case "vendor": {
        const { vendors } = await import("./db/schema");
        const vendor = await db
          .select()
          .from(vendors)
          .where(eq(vendors.id, parseInt(entityId)))
          .limit(1);
        exists = vendor.length > 0;
        break;
      }
        
      case "quote": {
        const { quotes } = await import("./db/schema");
        const quote = await db
          .select()
          .from(quotes)
          .where(eq(quotes.id, parseInt(entityId)))
          .limit(1);
        exists = quote.length > 0;
        break;
      }
        
      case "part": {
        const { parts } = await import("./db/schema");
        const part = await db
          .select()
          .from(parts)
          .where(eq(parts.id, entityId))
          .limit(1);
        exists = part.length > 0;
        break;
      }
    }
    
    return exists;
  } catch {
    return false;
  }
}