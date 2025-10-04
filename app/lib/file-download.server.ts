import { getFileInfo } from "~/lib/s3.server";

/**
 * Extracts the original filename from various sources:
 * 1. Attachment record (if available)
 * 2. S3 metadata (originalFileName or originalfilename)
 * 3. S3 key pattern matching as fallback
 */
export async function getOriginalFilename(
  s3Key: string,
  attachmentFilename?: string | null
): Promise<string | null> {
  // 1. Use attachment filename if available
  if (attachmentFilename) {
    return attachmentFilename;
  }

  try {
    // 2. Try S3 metadata
    const fileInfo = await getFileInfo(s3Key);
    const metadataFilename = fileInfo.metadata?.originalFileName || fileInfo.metadata?.originalfilename;

    if (metadataFilename) {
      return metadataFilename;
    }

    // 3. Fallback: Extract from S3 key pattern
    const keyParts = s3Key.split('/');
    const filenamePart = keyParts[keyParts.length - 1];

    // Pattern: timestamp-[part-|quote-part-]?uuid-originalname.ext
    const uuidPattern = /^\d+-(?:part-|quote-part-)?[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}-(.+)$/;
    // Simple pattern: timestamp-originalname.ext
    const simplePattern = /^\d+-(.+)$/;

    let match = filenamePart.match(uuidPattern);
    if (match) {
      return match[1];
    }

    match = filenamePart.match(simplePattern);
    if (match) {
      return match[1];
    }

    // If no pattern matches, return the filename part as-is
    return filenamePart;
  } catch (error) {
    console.error('Failed to get original filename:', error);
    return null;
  }
}