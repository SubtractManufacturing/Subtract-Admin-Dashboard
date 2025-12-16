/**
 * CAD File Version Management
 * Handles version history for CAD files on parts and quote parts
 *
 * Note: Mesh files are NOT versioned - only stored on parent entity.
 * When CAD version changes, mesh is deleted and regenerated.
 */

import { db } from "./db";
import { cadFileVersions, type CadFileVersion } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";

export type CadEntityType = "quote_part" | "part";

export interface CreateCadVersionInput {
  s3Key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

/**
 * Get all versions for an entity (newest first)
 */
export async function getCadVersions(
  entityType: CadEntityType,
  entityId: string
): Promise<CadFileVersion[]> {
  return db
    .select()
    .from(cadFileVersions)
    .where(
      and(
        eq(cadFileVersions.entityType, entityType),
        eq(cadFileVersions.entityId, entityId)
      )
    )
    .orderBy(desc(cadFileVersions.version));
}

/**
 * Get current (active) version for an entity
 */
export async function getCurrentCadVersion(
  entityType: CadEntityType,
  entityId: string
): Promise<CadFileVersion | undefined> {
  const [version] = await db
    .select()
    .from(cadFileVersions)
    .where(
      and(
        eq(cadFileVersions.entityType, entityType),
        eq(cadFileVersions.entityId, entityId),
        eq(cadFileVersions.isCurrentVersion, true)
      )
    )
    .limit(1);
  return version;
}

/**
 * Get the latest version number for an entity
 */
export async function getLatestVersionNumber(
  entityType: CadEntityType,
  entityId: string
): Promise<number> {
  const versions = await getCadVersions(entityType, entityId);
  if (versions.length === 0) return 0;
  return Math.max(...versions.map((v) => v.version));
}

/**
 * Create new version (handles version increment, sets as current)
 */
export async function createCadVersion(
  entityType: CadEntityType,
  entityId: string,
  file: CreateCadVersionInput,
  uploadedBy: string,
  uploadedByEmail: string,
  notes?: string
): Promise<CadFileVersion> {
  // Get next version number
  const nextVersion = (await getLatestVersionNumber(entityType, entityId)) + 1;

  // Unset current flag on all existing versions
  await db
    .update(cadFileVersions)
    .set({ isCurrentVersion: false })
    .where(
      and(
        eq(cadFileVersions.entityType, entityType),
        eq(cadFileVersions.entityId, entityId)
      )
    );

  // Insert new version as current
  const [newVersion] = await db
    .insert(cadFileVersions)
    .values({
      entityType,
      entityId,
      version: nextVersion,
      isCurrentVersion: true,
      s3Key: file.s3Key,
      fileName: file.fileName,
      fileSize: file.fileSize,
      contentType: file.contentType,
      uploadedBy,
      uploadedByEmail,
      notes,
    })
    .returning();

  return newVersion;
}

/**
 * Restore a previous version as current
 * Note: This does NOT copy the file, just sets the isCurrentVersion flag
 * The caller is responsible for updating the parent entity and triggering mesh regeneration
 */
export async function restoreVersion(
  versionId: string
): Promise<CadFileVersion> {
  // Get the version to restore
  const [versionToRestore] = await db
    .select()
    .from(cadFileVersions)
    .where(eq(cadFileVersions.id, versionId))
    .limit(1);

  if (!versionToRestore) {
    throw new Error("Version not found");
  }

  // Unset current flag on all versions for this entity
  await db
    .update(cadFileVersions)
    .set({ isCurrentVersion: false })
    .where(
      and(
        eq(cadFileVersions.entityType, versionToRestore.entityType),
        eq(cadFileVersions.entityId, versionToRestore.entityId)
      )
    );

  // Set restored version as current
  const [updatedVersion] = await db
    .update(cadFileVersions)
    .set({ isCurrentVersion: true })
    .where(eq(cadFileVersions.id, versionId))
    .returning();

  return updatedVersion;
}

/**
 * Get version by ID
 */
export async function getCadVersionById(
  versionId: string
): Promise<CadFileVersion | undefined> {
  const [version] = await db
    .select()
    .from(cadFileVersions)
    .where(eq(cadFileVersions.id, versionId))
    .limit(1);
  return version;
}

/**
 * Get version count for an entity
 */
export async function getCadVersionCount(
  entityType: CadEntityType,
  entityId: string
): Promise<number> {
  const versions = await getCadVersions(entityType, entityId);
  return versions.length;
}

/**
 * Check if a filename has the timestamp-hash prefix pattern
 * Pattern: 1765909500913-137c241618d7e1dc-filename.ext
 */
function hasPrefixedFilename(fileName: string): boolean {
  const prefixPattern = /^\d{13,}-[a-f0-9]{16}-.+$/i;
  return prefixPattern.test(fileName);
}

/**
 * Backfill existing CAD file as v1 if no version history exists
 * This preserves files uploaded before version history was implemented
 * Also updates existing v1 records if they have missing data (fileSize, prefixed filename)
 *
 * @param entityType - "quote_part" or "part"
 * @param entityId - The entity ID
 * @param existingFile - Info about the existing file to backfill
 * @returns The created/updated version record, or null if no backfill was needed
 */
export async function backfillExistingCadFile(
  entityType: CadEntityType,
  entityId: string,
  existingFile: {
    s3Key: string;
    fileName: string;
    fileSize?: number;
    contentType?: string;
  } | null
): Promise<CadFileVersion | null> {
  // Check if there's an existing file to backfill
  if (!existingFile?.s3Key) {
    // No existing file, no backfill needed
    return null;
  }

  // Check if version history already exists
  const existingVersions = await getCadVersions(entityType, entityId);
  
  if (existingVersions.length > 0) {
    // Version exists - check if we should update it with better data
    const v1 = existingVersions.find(v => v.version === 1);
    if (v1) {
      const needsUpdate = 
        // Update if existing has no fileSize but we have one
        (v1.fileSize === null && existingFile.fileSize) ||
        // Update if existing has prefixed filename but we have a clean one
        (hasPrefixedFilename(v1.fileName) && !hasPrefixedFilename(existingFile.fileName));
      
      if (needsUpdate) {
        const updates: Partial<CadFileVersion> = {};
        
        if (v1.fileSize === null && existingFile.fileSize) {
          updates.fileSize = existingFile.fileSize;
        }
        
        if (hasPrefixedFilename(v1.fileName) && !hasPrefixedFilename(existingFile.fileName)) {
          updates.fileName = existingFile.fileName;
        }
        
        if (Object.keys(updates).length > 0) {
          const [updatedVersion] = await db
            .update(cadFileVersions)
            .set(updates)
            .where(eq(cadFileVersions.id, v1.id))
            .returning();
          return updatedVersion;
        }
      }
    }
    return null;
  }

  // Create v1 record for the existing file
  const [backfilledVersion] = await db
    .insert(cadFileVersions)
    .values({
      entityType,
      entityId,
      version: 1,
      isCurrentVersion: true, // Will be unset when new version is created
      s3Key: existingFile.s3Key,
      fileName: existingFile.fileName,
      fileSize: existingFile.fileSize || null,
      contentType: existingFile.contentType || "application/octet-stream",
      uploadedBy: null, // Unknown - uploaded before version tracking
      uploadedByEmail: null,
      notes: "Original file (uploaded before version history)",
    })
    .returning();

  return backfilledVersion;
}
