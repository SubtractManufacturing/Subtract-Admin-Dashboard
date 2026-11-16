/**
 * Production adapters for the ports shared by the Quote and Order detail seams.
 * Tests use in-memory/`vi.fn` adapters instead (see each module's test-support).
 */
import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import { attachments } from "~/lib/db/schema";
import { getEnv } from "~/lib/env.server";
import { createEvent } from "~/lib/events";
import { createNote, getNotes, updateNote, archiveNote } from "~/lib/notes";
import { generateDocumentPdf } from "~/lib/pdf-service.server";
import { generatePdfThumbnail, isPdfFile } from "~/lib/pdf-thumbnail.server";
import {
  deleteFile,
  generateFileKey,
  getDownloadUrl,
  uploadFile,
} from "~/lib/s3.server";
import type { DocumentGenerationDeps } from "./entity-documents";
import type { DrawingUploadPorts } from "./drawing-uploads";
import type { NotesPort } from "./note-intents";
import type { EventsPort, FilesPort } from "./ports";
import type { LayoutSlot, SendComposerPorts } from "./send-composer";

export const filesAdapter: FilesPort = {
  upload: uploadFile,
  delete: deleteFile,
  signedUrl: getDownloadUrl,
  keyFor: generateFileKey,
};

export const eventsAdapter: EventsPort = {
  create: (event) => createEvent(event),
};

export const notesAdapter: NotesPort = {
  list: getNotes,
  create: (data, actor) => createNote(data, actor),
  update: updateNote,
  archive: archiveNote,
};

export const documentsAdapter: DocumentGenerationDeps = {
  generateDocumentPdf: (input) => generateDocumentPdf(input),
  async findAttachmentKey(attachmentId) {
    const [row] = await db
      .select({ s3Key: attachments.s3Key })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1);
    return row?.s3Key ?? null;
  },
  signDownloadUrl: getDownloadUrl,
};

export const drawingUploadsAdapter: DrawingUploadPorts = {
  storage: { upload: async (input) => ({ key: (await uploadFile(input)).key }) },
  thumbnails: {
    async fromPdf(pdf) {
      const thumbnail = await generatePdfThumbnail(pdf, 200, 200);
      return thumbnail.buffer;
    },
    isPdf: (contentType, fileName) => isPdfFile(contentType, fileName),
  },
  attachments: {
    async create(input) {
      const [row] = await db
        .insert(attachments)
        .values({
          s3Bucket: getEnv("S3_BUCKET") || "default-bucket",
          s3Key: input.s3Key,
          fileName: input.fileName,
          contentType: input.contentType,
          fileSize: input.fileSize,
          thumbnailS3Key: input.thumbnailS3Key,
          source: input.source,
        })
        .returning({ id: attachments.id });
      return row;
    },
  },
};

/** Email template/layout lookups, loaded lazily so non-email pages never pay for them. */
export const sendComposerAdapter: SendComposerPorts = {
  async resolveTemplate(contextKey) {
    const { resolveEmailTemplateForContext } = await import("~/lib/email/templates.server");
    return resolveEmailTemplateForContext(contextKey);
  },
  async mergeFields() {
    const { getEmailMergeFieldsMap } = await import("~/lib/email/templates.server");
    return getEmailMergeFieldsMap();
  },
  async interpolate(template, vars) {
    const { interpolateTemplateString } = await import("~/emails/render.server");
    return interpolateTemplateString(template, vars);
  },
  async layoutSlots(layoutSlug) {
    const { getLayoutDefinition } = await import("~/emails/registry");
    return getLayoutDefinition(layoutSlug).slots as readonly LayoutSlot[];
  },
  async parseBodyCopy(layoutSlug, raw) {
    const { parseBodyCopyForLayout } = await import("~/emails/registry");
    return parseBodyCopyForLayout(layoutSlug, raw);
  },
};
