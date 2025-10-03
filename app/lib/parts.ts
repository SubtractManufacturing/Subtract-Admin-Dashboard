import { db } from "./db/index.js"
import { parts, partModels, partDrawings, attachments } from "./db/schema.js"
import { eq, desc, ilike, or, and } from 'drizzle-orm'
import type { Part } from "./db/schema.js"
import { detectFileFormat, isConversionEnabled } from "./conversion-service.server.js"
import { convertPartToMesh } from "./mesh-converter.server.js"
import { createEvent } from "./events.js"
import { getDownloadUrl } from "./s3.server.js"

export type { Part }

export type PartInput = {
  customerId?: number | null
  partName?: string | null
  notes?: string | null
  material?: string | null
  tolerance?: string | null
  finishing?: string | null
  thumbnailUrl?: string | null
  partFileUrl?: string | null
  partMeshUrl?: string | null
}

export type PartEventContext = {
  userId?: string
  userEmail?: string
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

export async function createPart(partData: PartInput, eventContext?: PartEventContext): Promise<Part> {
  try {
    const result = await db
      .insert(parts)
      .values({
        ...partData,
        updatedAt: new Date()
      })
      .returning()

    const newPart = result[0]

    // Log event
    await createEvent({
      entityType: "part",
      entityId: newPart.id,
      eventType: "part_created",
      eventCategory: "system",
      title: "Part Created",
      description: `Created part: ${newPart.partName || "Unnamed"}`,
      metadata: {
        partName: newPart.partName,
        customerId: newPart.customerId,
        material: newPart.material,
        tolerance: newPart.tolerance,
        finishing: newPart.finishing
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })

    // Trigger mesh conversion if applicable
    if (newPart.partFileUrl && !newPart.partMeshUrl) {
      await triggerMeshConversion(newPart.id, newPart.partFileUrl)
    }

    return newPart
  } catch (error) {
    console.error("Error creating part:", error);
    throw new Error(`Failed to create part: ${error}`)
  }
}

export async function updatePart(id: string, partData: Partial<PartInput>, eventContext?: PartEventContext): Promise<Part> {
  try {
    const result = await db
      .update(parts)
      .set({
        ...partData,
        updatedAt: new Date()
      })
      .where(eq(parts.id, id))
      .returning()

    const updatedPart = result[0]

    // Log event
    await createEvent({
      entityType: "part",
      entityId: id,
      eventType: "part_updated",
      eventCategory: "system",
      title: "Part Updated",
      description: `Updated part: ${updatedPart.partName || "Unnamed"}`,
      metadata: {
        updatedFields: Object.keys(partData),
        ...partData
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })

    // Trigger mesh conversion if model file was updated and no mesh exists
    if (partData.partFileUrl && !updatedPart.partMeshUrl) {
      await triggerMeshConversion(updatedPart.id, partData.partFileUrl)
    }

    return updatedPart
  } catch (error) {
    throw new Error(`Failed to update part: ${error}`)
  }
}

export async function deletePart(id: string, eventContext?: PartEventContext): Promise<void> {
  try {
    // Get part details before deletion
    const part = await getPart(id)

    await db
      .delete(parts)
      .where(eq(parts.id, id))

    // Log event if part existed
    if (part) {
      await createEvent({
        entityType: "part",
        entityId: id,
        eventType: "part_deleted",
        eventCategory: "system",
        title: "Part Deleted",
        description: `Deleted part: ${part.partName || "Unnamed"}`,
        metadata: {
          partName: part.partName,
          customerId: part.customerId
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
      })
    }
  } catch (error) {
    throw new Error(`Failed to delete part: ${error}`)
  }
}

export async function archivePart(id: string, eventContext?: PartEventContext): Promise<void> {
  try {
    // Get part details before archiving
    const part = await getPart(id)

    await db
      .update(parts)
      .set({ isArchived: true })
      .where(eq(parts.id, id))

    // Log event if part existed
    if (part) {
      await createEvent({
        entityType: "part",
        entityId: id,
        eventType: "part_archived",
        eventCategory: "system",
        title: "Part Archived",
        description: `Archived part: ${part.partName || "Unnamed"}`,
        metadata: {
          partName: part.partName,
          customerId: part.customerId
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
      })
    }
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

/**
 * Convert S3 keys to signed URLs for parts array
 * This ensures thumbnails don't expire
 */
export async function hydratePartThumbnails(parts: Part[]): Promise<Part[]> {
  return Promise.all(
    parts.map(async (part) => {
      if (part.thumbnailUrl && !part.thumbnailUrl.startsWith('http')) {
        // It's an S3 key, generate signed URL
        try {
          part.thumbnailUrl = await getDownloadUrl(part.thumbnailUrl, 3600);
        } catch (error) {
          console.error(`Failed to generate thumbnail URL for part ${part.id}:`, error);
          part.thumbnailUrl = null;
        }
      }
      return part;
    })
  );
}

/**
 * Convert S3 key to signed URL for a single part
 */
export async function hydratePartThumbnail(part: Part): Promise<Part> {
  if (part.thumbnailUrl && !part.thumbnailUrl.startsWith('http')) {
    try {
      part.thumbnailUrl = await getDownloadUrl(part.thumbnailUrl, 3600);
    } catch (error) {
      console.error(`Failed to generate thumbnail URL for part ${part.id}:`, error);
      part.thumbnailUrl = null;
    }
  }
  return part;
}

/**
 * Get signed URL for part mesh file
 */
export async function getPartMeshUrl(partId: string): Promise<{ url: string } | { error: string }> {
  try {
    // Get the part from database
    const part = await getPart(partId)

    if (!part) {
      return { error: "Part not found" }
    }

    if (!part.partMeshUrl) {
      return { error: "Part has no mesh file" }
    }

    // Extract the S3 key from the mesh URL
    let key: string
    const meshUrl = part.partMeshUrl

    // Handle different URL formats
    if (meshUrl.includes("/storage/v1/")) {
      // Supabase storage URL format
      const urlParts = meshUrl.split("/storage/v1/s3/")
      if (urlParts[1]) {
        const bucketAndKey = urlParts[1]
        // Remove bucket name (testing-bucket/) to get the key
        key = bucketAndKey.replace(/^[^/]+\//, "")
      } else {
        return { error: "Invalid mesh URL format" }
      }
    } else if (meshUrl.includes("parts/") && meshUrl.includes("/mesh/")) {
      // Direct S3 key format
      const urlParts = meshUrl.split("/")
      const partsIndex = urlParts.indexOf("parts")
      if (partsIndex >= 0) {
        key = urlParts.slice(partsIndex).join("/")
      } else {
        key = meshUrl
      }
    } else {
      // Try to extract key from full URL
      const urlParts = meshUrl.split("/")
      const partsIndex = urlParts.findIndex(p => p === "parts")
      if (partsIndex >= 0) {
        key = urlParts.slice(partsIndex).join("/")
      } else {
        return { error: "Cannot extract key from mesh URL" }
      }
    }

    // Generate a signed URL for the mesh file
    const signedUrl = await getDownloadUrl(key, 3600) // 1 hour expiry

    return { url: signedUrl }
  } catch (error) {
    console.error("Error getting mesh URL:", error)
    return { error: "Failed to generate mesh URL" }
  }
}

/**
 * Trigger mesh conversion for a part (non-blocking)
 */
async function triggerMeshConversion(partId: string, fileUrl: string) {
  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    console.log("Mesh conversion service not configured - skipping")
    return
  }

  // Check if file is a BREP format
  const filename = fileUrl.split('/').pop() || ''
  const format = detectFileFormat(filename)

  if (format !== "brep") {
    console.log(`File ${filename} is not a BREP format - skipping conversion`)
    return
  }

  // Start conversion asynchronously
  console.log(`Triggering mesh conversion for part ${partId}`)
  convertPartToMesh(partId, fileUrl).catch((error) => {
    console.error(`Failed to convert mesh for part ${partId}:`, error)
  })
}