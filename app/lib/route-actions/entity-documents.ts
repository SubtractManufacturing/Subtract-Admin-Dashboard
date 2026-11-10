/**
 * Generate a PDF document for an entity and answer with a signed download URL.
 *
 * One module replaces five copy-pasted handlers (quote Quote/Invoice, order
 * PO/Invoice/Packing Slip). Callers pick the filename and document kind; this
 * module owns the contract: 400 without HTML, 500 with the failure message,
 * otherwise `{ success, downloadUrl, attachmentId, filename }`.
 */
import { json } from "@remix-run/node";
import type { AttachmentDocumentKind } from "~/lib/db/schema";
import { badRequest, type Actor } from "./core";

/** Signed-link lifetime for freshly generated documents (1 hour). */
export const DOCUMENT_URL_TTL_SECONDS = 3600;

export type DocumentGenerationDeps = {
  /** Render HTML to PDF, store it, and link it to the entity. */
  generateDocumentPdf(input: {
    entityType: "quote" | "order";
    entityId: number;
    htmlContent: string;
    filename: string;
    documentKind: AttachmentDocumentKind;
    userId?: string;
    userEmail?: string;
  }): Promise<{ attachmentId: string }>;
  /** Storage key of an attachment, or null when the record is missing. */
  findAttachmentKey(attachmentId: string): Promise<string | null>;
  signDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
};

export async function generateEntityDocument(
  deps: DocumentGenerationDeps,
  input: {
    entityType: "quote" | "order";
    entityId: number;
    htmlContent: FormDataEntryValue | null;
    filename: string;
    documentKind: AttachmentDocumentKind;
    actor: Actor;
  },
): Promise<Response> {
  if (typeof input.htmlContent !== "string" || !input.htmlContent) {
    return badRequest("Missing HTML content");
  }

  try {
    const { attachmentId } = await deps.generateDocumentPdf({
      entityType: input.entityType,
      entityId: input.entityId,
      htmlContent: input.htmlContent,
      filename: input.filename,
      documentKind: input.documentKind,
      userId: input.actor.userId,
      userEmail: input.actor.userEmail,
    });

    const key = await deps.findAttachmentKey(attachmentId);
    if (!key) {
      throw new Error("Failed to create attachment");
    }

    const downloadUrl = await deps.signDownloadUrl(key, DOCUMENT_URL_TTL_SECONDS);

    return json({
      success: true,
      downloadUrl,
      attachmentId,
      filename: input.filename,
    });
  } catch (pdfError) {
    console.error("PDF generation failed:", pdfError);
    return json(
      {
        error:
          pdfError instanceof Error ? pdfError.message : "Failed to generate PDF",
      },
      { status: 500 },
    );
  }
}
