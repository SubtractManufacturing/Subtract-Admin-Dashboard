/**
 * Technical-drawing upload: store the file, thumbnail PDFs, record an
 * Attachment, and link it to its owner (a Part or QuotePart).
 *
 * One module replaces five copies that differed only in key prefix, content
 * type rule, and the link table. Storage, thumbnailing and the attachment
 * record sit behind {@link DrawingUploadPorts}: S3 + MuPDF + Postgres in
 * production, in-memory fakes in tests.
 */

export type DrawingFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/** A drawing in a multipart form together with its form position (`drawing_<index>`). */
export type IndexedDrawing = { file: DrawingFile; index: number };

export type DrawingUploadPorts = {
  storage: {
    upload(input: {
      key: string;
      buffer: Buffer;
      contentType: string;
      fileName: string;
    }): Promise<{ key: string }>;
  };
  thumbnails: {
    /** PNG bytes for the first page of a PDF. May throw; callers tolerate that. */
    fromPdf(pdf: Buffer): Promise<Buffer>;
    isPdf(contentType: string, fileName: string): boolean;
  };
  attachments: {
    create(input: {
      s3Key: string;
      fileName: string;
      contentType: string;
      fileSize: number;
      thumbnailS3Key: string | null;
      source: "user_upload";
    }): Promise<{ id: string }>;
  };
};

/** Replace whitespace with `-` and drop anything outside `[a-zA-Z0-9._-]`. */
export function sanitizeUploadFileName(name: string): string {
  return name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
}

/**
 * Pull `drawing_0 … drawing_<drawingCount-1>` out of a form, skipping empty
 * slots but keeping each file's original position for key generation.
 */
export function collectDrawingFiles(formData: FormData): IndexedDrawing[] {
  const count = parseInt(String(formData.get("drawingCount") ?? ""), 10) || 0;
  const drawings: IndexedDrawing[] = [];
  for (let index = 0; index < count; index++) {
    const value = formData.get(`drawing_${index}`);
    if (value && typeof value !== "string" && value.size > 0) {
      drawings.push({ file: value as DrawingFile, index });
    }
  }
  return drawings;
}

export type UploadDrawingsInput = {
  drawings: IndexedDrawing[];
  /** Storage prefix, without trailing slash. e.g. `parts/<id>/drawings` */
  keyPrefix: string;
  /** Added to each drawing's form index when naming keys (primary drawing owns slot 0). */
  indexOffset?: number;
  /** Content type rule. Default: the browser-reported type, else PDF. */
  contentTypeFor?: (file: DrawingFile) => string;
  /** Persist the owner link (part_drawings / quote_part_drawings row). */
  link(attachmentId: string): Promise<void>;
  now?: () => number;
};

const defaultContentType = (file: DrawingFile) => file.type || "application/pdf";

/** Upload and link each drawing in order. Returns the created attachment ids. */
export async function uploadDrawings(
  ports: DrawingUploadPorts,
  input: UploadDrawingsInput,
): Promise<string[]> {
  const contentTypeFor = input.contentTypeFor ?? defaultContentType;
  const now = input.now ?? Date.now;
  const attachmentIds: string[] = [];

  for (const { file, index } of input.drawings) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitizeUploadFileName(file.name);
    const contentType = contentTypeFor(file);
    const key = `${input.keyPrefix}/${now()}-${index + (input.indexOffset ?? 0)}-${safeName}`;

    const stored = await ports.storage.upload({
      key,
      buffer,
      contentType,
      fileName: safeName,
    });

    let thumbnailS3Key: string | null = null;
    if (ports.thumbnails.isPdf(file.type, file.name)) {
      try {
        const png = await ports.thumbnails.fromPdf(buffer);
        const thumbKey = `${key}.thumb.png`;
        await ports.storage.upload({
          key: thumbKey,
          buffer: png,
          contentType: "image/png",
          fileName: `${safeName}.thumb.png`,
        });
        thumbnailS3Key = thumbKey;
      } catch (error) {
        // A missing thumbnail must never fail the upload.
        console.error("Failed to generate PDF thumbnail:", error);
      }
    }

    const attachment = await ports.attachments.create({
      s3Key: stored.key,
      fileName: file.name,
      contentType,
      fileSize: file.size,
      thumbnailS3Key,
      source: "user_upload",
    });
    await input.link(attachment.id);
    attachmentIds.push(attachment.id);
  }

  return attachmentIds;
}
