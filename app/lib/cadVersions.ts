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
