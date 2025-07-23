import { db } from "./db/index.js"
import { parts } from "./db/schema.js"
import { eq, desc, ilike, or, and } from 'drizzle-orm'
import type { Part, NewPart } from "./db/schema.js"

export type { Part }

export type PartInput = {
  partName?: string | null
  notes?: string | null
  material?: string | null
  tolerance?: string | null
  finishing?: string | null
}

export type PartWithCounts = Part & {
  orderLineItemsCount: number
  quoteLineItemsCount: number
}

export async function getParts(): Promise<Part[]> {
  try {
    const result = await db
      .select()
      .from(parts)
      .where(eq(parts.isArchived, false))
      .orderBy(desc(parts.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching parts:', error)
    return []
  }
}

export async function searchParts(query: string): Promise<Part[]> {
  try {
    const result = await db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.isArchived, false),
          or(
            ilike(parts.partName, `%${query}%`),
            ilike(parts.material, `%${query}%`),
            ilike(parts.notes, `%${query}%`)
          )
        )
      )
      .orderBy(desc(parts.createdAt))

    return result
  } catch (error) {
    console.error('Error searching parts:', error)
    return []
  }
}

export async function getPart(id: string): Promise<Part | null> {
  try {
    const result = await db
      .select()
      .from(parts)
      .where(eq(parts.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get part: ${error}`)
  }
}

export async function createPart(partData: PartInput): Promise<Part> {
  try {
    const result = await db
      .insert(parts)
      .values({
        ...partData,
        updatedAt: new Date()
      })
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create part: ${error}`)
  }
}

export async function updatePart(id: string, partData: Partial<PartInput>): Promise<Part> {
  try {
    const result = await db
      .update(parts)
      .set({
        ...partData,
        updatedAt: new Date()
      })
      .where(eq(parts.id, id))
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update part: ${error}`)
  }
}

export async function deletePart(id: string): Promise<void> {
  try {
    await db
      .delete(parts)
      .where(eq(parts.id, id))
  } catch (error) {
    throw new Error(`Failed to delete part: ${error}`)
  }
}

export async function archivePart(id: string): Promise<void> {
  try {
    await db
      .update(parts)
      .set({ isArchived: true })
      .where(eq(parts.id, id))
  } catch (error) {
    throw new Error(`Failed to archive part: ${error}`)
  }
}