import { db } from "./db/index.js"
import { parts, partModels, partDrawings, attachments } from "./db/schema.js"
import { eq, desc, ilike, or, and } from 'drizzle-orm'
import type { Part } from "./db/schema.js"

export type { Part }

export type PartInput = {
  customerId?: number | null
  partName?: string | null
  notes?: string | null
  material?: string | null
  tolerance?: string | null
  finishing?: string | null
  thumbnailUrl?: string | null
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
    console.error("Error creating part:", error);
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

export async function getPartsByCustomerId(customerId: number): Promise<Part[]> {
  try {
    const result = await db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.customerId, customerId),
          eq(parts.isArchived, false)
        )
      )
      .orderBy(desc(parts.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching customer parts:', error)
    return []
  }
}

export async function getPartWithAttachments(partId: string) {
  try {
    const part = await getPart(partId)
    if (!part) return null

    // Get part models (3D files) with attachments
    const modelsData = await db
      .select({
        model: partModels,
        attachment: attachments
      })
      .from(partModels)
      .innerJoin(attachments, eq(partModels.attachmentId, attachments.id))
      .where(eq(partModels.partId, partId))

    // Get part drawings with attachments
    const drawingsData = await db
      .select({
        drawing: partDrawings,
        attachment: attachments
      })
      .from(partDrawings)
      .innerJoin(attachments, eq(partDrawings.attachmentId, attachments.id))
      .where(eq(partDrawings.partId, partId))

    return {
      ...part,
      models: modelsData.map(d => ({ ...d.model, attachment: d.attachment })),
      drawings: drawingsData.map(d => ({ ...d.drawing, attachment: d.attachment }))
    }
  } catch (error) {
    console.error('Error fetching part with attachments:', error)
    return null
  }
}