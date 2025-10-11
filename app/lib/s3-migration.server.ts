/**
 * S3 Storage Migration Utilities
 *
 * Consolidates old "quotes/" folder structure into organized "quote-parts/" structure
 */

import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getS3Client } from './s3.server'
import { db } from './db/index'
import { quoteParts } from './db/schema'
import { eq, like, and, isNotNull } from 'drizzle-orm'

const S3_BUCKET = process.env.S3_BUCKET || 'subtract-attachments'

export type MigrationResult = {
  success: boolean
  filesMoved: number
  filesSkipped: number
  errors: string[]
  details: string[]
}

/**
 * Lists all files in the deprecated "quotes/" folder
 */
export async function listDeprecatedQuoteFiles(): Promise<{
  files: { key: string; size?: number; lastModified?: Date }[]
  totalSize: number
}> {
  const client = getS3Client()
  const files: { key: string; size?: number; lastModified?: Date }[] = []
  let totalSize = 0
  let continuationToken: string | undefined

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: 'quotes/',
        ContinuationToken: continuationToken,
      })

      const response = await client.send(command)

      if (response.Contents) {
        for (const item of response.Contents) {
          if (item.Key && item.Key !== 'quotes/') { // Skip the folder itself
            files.push({
              key: item.Key,
              size: item.Size,
              lastModified: item.LastModified,
            })
            totalSize += item.Size || 0
          }
        }
      }

      continuationToken = response.NextContinuationToken
    } while (continuationToken)

    return { files, totalSize }
  } catch (error) {
    console.error('Error listing deprecated quote files:', error)
    throw error
  }
}

/**
 * Consolidates quote files from "quotes/" to "quote-parts/{id}/source/"
 * Matches files to quote parts based on partFileUrl in the database
 */
export async function consolidateQuoteFiles(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    filesMoved: 0,
    filesSkipped: 0,
    errors: [],
    details: [],
  }

  try {
    // Get all quote parts that have files in the old "quotes/" folder
    const parts = await db
      .select()
      .from(quoteParts)
      .where(
        and(
          isNotNull(quoteParts.partFileUrl),
          like(quoteParts.partFileUrl, 'quotes/%')
        )
      )

    result.details.push(`Found ${parts.length} quote parts with files in quotes/ folder`)

    // Get list of all files in quotes/ folder
    const { files } = await listDeprecatedQuoteFiles()
    result.details.push(`Found ${files.length} files in quotes/ folder`)

    // For each part, find its file and move it
    for (const part of parts) {
      try {
        if (!part.partFileUrl || !part.partFileUrl.startsWith('quotes/')) {
          result.filesSkipped++
          continue
        }

        const oldKey = part.partFileUrl

        // Check if file exists in the list
        const fileExists = files.some(f => f.key === oldKey)
        if (!fileExists) {
          result.errors.push(`File not found in S3: ${oldKey}`)
          result.filesSkipped++
          continue
        }

        // Extract original filename from the old key
        // Old format: quotes/{timestamp}-{random}.{ext}
        const oldFilename = oldKey.split('/').pop() || 'file'
        const extension = oldFilename.split('.').pop() || 'bin'

        // Generate new key with proper structure
        // New format: quote-parts/{quotePartId}/source/{timestamp}-{random}-{originalName}
        const timestamp = Date.now()
        const newKey = `quote-parts/${part.id}/source/${timestamp}-${oldFilename}`

        // Copy file to new location
        const copyCommand = new CopyObjectCommand({
          Bucket: S3_BUCKET,
          CopySource: `${S3_BUCKET}/${oldKey}`,
          Key: newKey,
        })
        await getS3Client().send(copyCommand)

        // Update database with new key
        await db
          .update(quoteParts)
          .set({
            partFileUrl: newKey,
            updatedAt: new Date(),
          })
          .where(eq(quoteParts.id, part.id))

        // Delete the old file after successful copy and database update
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: oldKey,
          })
          await getS3Client().send(deleteCommand)
          result.details.push(`Deleted old file: ${oldKey}`)
        } catch (deleteError) {
          // Log but don't fail - the new file is in place and DB is updated
          result.details.push(`Warning: Could not delete old file ${oldKey}: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`)
        }

        result.filesMoved++
        result.details.push(`Moved: ${oldKey} → ${newKey}`)
      } catch (error) {
        const errorMsg = `Failed to move file for part ${part.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        result.errors.push(errorMsg)
        result.success = false
      }
    }

    return result
  } catch (error) {
    result.success = false
    result.errors.push(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return result
  }
}

/**
 * Deletes any remaining orphaned files in the deprecated "quotes/" folder
 * WARNING: Only run this after consolidateQuoteFiles() has been verified successful
 *
 * Note: consolidateQuoteFiles() already deletes files as it moves them. This function
 * is for cleaning up any orphaned files that don't have database references.
 */
export async function cleanupDeprecatedQuotesFolder(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    filesMoved: 0,
    filesSkipped: 0,
    errors: [],
    details: [],
  }

  try {
    // First, verify that no quote parts still reference the quotes/ folder
    const partsWithOldPaths = await db
      .select()
      .from(quoteParts)
      .where(
        and(
          isNotNull(quoteParts.partFileUrl),
          like(quoteParts.partFileUrl, 'quotes/%')
        )
      )

    if (partsWithOldPaths.length > 0) {
      result.success = false
      result.errors.push(
        `Cannot clean up: ${partsWithOldPaths.length} quote parts still reference the quotes/ folder. Run consolidation first.`
      )
      return result
    }

    // Get all files in quotes/ folder
    const { files, totalSize } = await listDeprecatedQuoteFiles()

    result.details.push(`Found ${files.length} files to delete (${(totalSize / 1024 / 1024).toFixed(2)} MB)`)

    // Delete each file
    for (const file of files) {
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: file.key,
        })
        await getS3Client().send(deleteCommand)
        result.filesMoved++ // Using filesMoved as filesDeleted
        result.details.push(`Deleted: ${file.key}`)
      } catch (error) {
        const errorMsg = `Failed to delete ${file.key}: ${error instanceof Error ? error.message : 'Unknown error'}`
        result.errors.push(errorMsg)
        result.success = false
      }
    }

    return result
  } catch (error) {
    result.success = false
    result.errors.push(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return result
  }
}

/**
 * Gets status information about the migration
 */
export async function getMigrationStatus(): Promise<{
  deprecatedFilesCount: number
  deprecatedFilesSize: number
  quotesPartsWithOldPaths: number
}> {
  try {
    const { files, totalSize } = await listDeprecatedQuoteFiles()

    const partsWithOldPaths = await db
      .select()
      .from(quoteParts)
      .where(
        and(
          isNotNull(quoteParts.partFileUrl),
          like(quoteParts.partFileUrl, 'quotes/%')
        )
      )

    return {
      deprecatedFilesCount: files.length,
      deprecatedFilesSize: totalSize,
      quotesPartsWithOldPaths: partsWithOldPaths.length,
    }
  } catch (error) {
    console.error('Error getting migration status:', error)
    return {
      deprecatedFilesCount: 0,
      deprecatedFilesSize: 0,
      quotesPartsWithOldPaths: 0,
    }
  }
}
