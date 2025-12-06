import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  redirect,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  getQuote,
  updateQuote,
  archiveQuote,
  restoreQuote,
  convertQuoteToOrder,
} from "~/lib/quotes";
import type { QuoteEventContext } from "~/lib/quotes";
import { getCustomer, getCustomers } from "~/lib/customers";
import { getVendor, getVendors } from "~/lib/vendors";
import { getOrder } from "~/lib/orders";
import {
  getAttachment,
  createAttachment,
  deleteAttachment,
  type AttachmentEventContext,
} from "~/lib/attachments";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import {
  shouldShowEventsInNav,
  shouldShowVersionInHeader,
  canUserAccessPriceCalculator,
  isFeatureEnabled,
  FEATURE_FLAGS,
} from "~/lib/featureFlags";
import {
  uploadFile,
  generateFileKey,
  deleteFile,
  getDownloadUrl,
} from "~/lib/s3.server";
import { generateDocumentPdf } from "~/lib/pdf-service.server";
import {
  getNotes,
  createNote,
  updateNote,
  archiveNote,
  type NoteEventContext,
} from "~/lib/notes";
import { getEventsByEntity, createEvent } from "~/lib/events";
import { db } from "~/lib/db";
import {
  quoteAttachments,
  attachments,
  quotes,
  quotePartDrawings,
} from "~/lib/db/schema";
import { eq } from "drizzle-orm";

import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import FileViewerModal from "~/components/shared/FileViewerModal";
import Modal from "~/components/shared/Modal";
import { Notes } from "~/components/shared/Notes";
import { EventTimeline } from "~/components/EventTimeline";
import { QuotePartsModal } from "~/components/quotes/QuotePartsModal";
import AddQuoteLineItemModal from "~/components/quotes/AddQuoteLineItemModal";
import QuoteActionsDropdown from "~/components/quotes/QuoteActionsDropdown";
import QuotePriceCalculatorModal from "~/components/quotes/QuotePriceCalculatorModal";
import GenerateQuotePdfModal from "~/components/quotes/GenerateQuotePdfModal";
import GenerateInvoicePdfModal from "~/components/orders/GenerateInvoicePdfModal";
import { HiddenThumbnailGenerator } from "~/components/HiddenThumbnailGenerator";
import { Part3DViewerModal } from "~/components/shared/Part3DViewerModal";
import { tableStyles } from "~/utils/tw-styles";
import { isViewableFile, getFileType, formatFileSize } from "~/lib/file-utils";
import {
  createPriceCalculation,
  getLatestCalculationsForQuote
} from "~/lib/quotePriceCalculations";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  const quoteId = params.quoteId;
  if (!quoteId) {
    throw new Response("Quote ID is required", { status: 400 });
  }

  const quote = await getQuote(parseInt(quoteId));
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }

  // Fetch customer and vendor details, plus all customers and vendors for editing
  const [customer, vendor, customers, vendors] = await Promise.all([
    quote.customerId ? getCustomer(quote.customerId) : null,
    quote.vendorId ? getVendor(quote.vendorId) : null,
    getCustomers(),
    getVendors(),
  ]);

  // Generate signed URLs for quote parts with meshes, solid files, thumbnails, and drawings
  const partsWithSignedUrls = await Promise.all(
    (quote.parts || []).map(async (part) => {
      let signedMeshUrl = undefined;
      let signedFileUrl = undefined;
      let signedThumbnailUrl = undefined;

      // Get signed mesh URL
      if (part.partMeshUrl && part.conversionStatus === "completed") {
        const { getQuotePartMeshUrl } = await import(
          "~/lib/quote-part-mesh-converter.server"
        );
        const result = await getQuotePartMeshUrl(part.id);
        if ("url" in result) {
          signedMeshUrl = result.url;
        }
      }

      // Get signed solid file URL (STEP, BREP, SLDPRT, etc.)
      if (part.partFileUrl) {
        try {
          // Extract S3 key from the URL
          let key: string;
          if (part.partFileUrl.includes("quote-parts/")) {
            const urlParts = part.partFileUrl.split("/");
            const quotePartsIndex = urlParts.findIndex(
              (p) => p === "quote-parts"
            );
            if (quotePartsIndex >= 0) {
              key = urlParts.slice(quotePartsIndex).join("/");
            } else {
              key = part.partFileUrl;
            }
          } else {
            key = part.partFileUrl;
          }
          signedFileUrl = await getDownloadUrl(key, 3600);
        } catch (error) {
          console.error(
            "Error getting signed file URL for part",
            part.id,
            ":",
            error
          );
        }
      }

      // Get signed thumbnail URL
      // thumbnailUrl is stored as just the S3 key (e.g., "quote-parts/abc-123/thumbnails/...")
      if (part.thumbnailUrl) {
        try {
          signedThumbnailUrl = await getDownloadUrl(part.thumbnailUrl, 3600);
        } catch (error) {
          console.error(
            "Error getting signed thumbnail URL for part",
            part.id,
            ":",
            error
          );
        }
      }

      // Fetch technical drawings for this part
      const drawingRecords = await db
        .select({
          drawing: quotePartDrawings,
          attachment: attachments,
        })
        .from(quotePartDrawings)
        .leftJoin(
          attachments,
          eq(quotePartDrawings.attachmentId, attachments.id)
        )
        .where(eq(quotePartDrawings.quotePartId, part.id));

      const drawings = await Promise.all(
        drawingRecords
          .filter((record) => record.attachment !== null)
          .map(async (record) => {
            const attachment = record.attachment!;
            try {
              const signedUrl = await getDownloadUrl(attachment.s3Key, 3600);
              return {
                id: attachment.id,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
                fileSize: attachment.fileSize,
                signedUrl,
              };
            } catch (error) {
              console.error(
                "Error getting signed URL for drawing",
                attachment.id,
                ":",
                error
              );
              return null;
            }
          })
      );

      return {
        ...part,
        signedMeshUrl,
        signedFileUrl,
        signedThumbnailUrl,
        drawings: drawings.filter((d) => d !== null),
      };
    })
  );

  // Update quote with signed URLs
  const quoteWithSignedUrls = { ...quote, parts: partsWithSignedUrls };

  // Fetch notes for this quote
  const notes = await getNotes("quote", quote.id.toString());

  // Fetch attachments for this quote
  const quoteAttachmentRecords = await db
    .select({
      attachment: attachments,
    })
    .from(quoteAttachments)
    .leftJoin(attachments, eq(quoteAttachments.attachmentId, attachments.id))
    .where(eq(quoteAttachments.quoteId, quote.id));

  const attachmentList = quoteAttachmentRecords
    .map((record) => record.attachment)
    .filter(
      (attachment): attachment is NonNullable<typeof attachment> =>
        attachment !== null
    );

  // Generate download URLs for attachments
  const attachmentsWithUrls = await Promise.all(
    attachmentList.map(async (attachment) => ({
      ...attachment,
      downloadUrl: await getDownloadUrl(attachment.s3Key),
    }))
  );

  // Get feature flags and events
  const [showEventsLink, showVersionInHeader, canAccessPriceCalculator, pdfAutoDownload, rejectionReasonRequired, events] = await Promise.all([
    shouldShowEventsInNav(),
    shouldShowVersionInHeader(),
    canUserAccessPriceCalculator(userDetails?.role),
    isFeatureEnabled(FEATURE_FLAGS.PDF_AUTO_DOWNLOAD),
    isFeatureEnabled(FEATURE_FLAGS.QUOTE_REJECTION_REASON_REQUIRED),
    getEventsByEntity("quote", quote.id.toString(), 10),
  ]);

  // Fetch converted order if exists
  const convertedOrder = quote.convertedToOrderId
    ? await getOrder(quote.convertedToOrderId)
    : null;

  // Fetch existing price calculations for the quote
  const priceCalculations = await getLatestCalculationsForQuote(quote.id);

  return withAuthHeaders(
    json({
      quote: quoteWithSignedUrls,
      customer,
      vendor,
      customers,
      vendors,
      notes,
      attachments: attachmentsWithUrls,
      user,
      userDetails,
      priceCalculations,
      appConfig,
      showEventsLink,
      showVersionInHeader,
      canAccessPriceCalculator,
      pdfAutoDownload,
      rejectionReasonRequired,
      events,
      convertedOrder,
    }),
    headers
  );
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const quoteId = params.quoteId;
  if (!quoteId) {
    return json({ error: "Quote ID is required" }, { status: 400 });
  }

  const quote = await getQuote(parseInt(quoteId));
  if (!quote) {
    return json({ error: "Quote not found" }, { status: 404 });
  }

  // Create event context for all operations
  const eventContext: QuoteEventContext = {
    userId: user?.id,
    userEmail: user?.email || userDetails?.name || undefined,
  };

  // Helper function to auto-convert RFQ to Draft when editing starts
  const autoConvertRFQToDraft = async () => {
    if (quote.status === "RFQ") {
      await updateQuote(quote.id, { status: "Draft" }, eventContext);
    }
  };

  // Parse form data once
  let formData: FormData;

  // Handle file uploads separately
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: MAX_FILE_SIZE,
    });

    formData = await unstable_parseMultipartFormData(
      request,
      uploadHandler
    );
    const intent = formData.get("intent");

    // Handle add line item with file upload
    if (intent === "addLineItem") {
      // Auto-convert RFQ to Draft when editing starts
      await autoConvertRFQToDraft();

      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const notes = formData.get("notes") as string;
      const quantity = formData.get("quantity") as string;
      const unitPrice = formData.get("unitPrice") as string;
      const file = formData.get("file") as File | null;

      if (!name || !quantity || !unitPrice) {
        return json({ error: "Missing required fields" }, { status: 400 });
      }

      try {
        let quotePartId: string | null = null;

        // If a file was uploaded, create a quote part
        if (file && file.size > 0) {
          const { quoteParts } = await import("~/lib/db/schema");
          const { triggerQuotePartMeshConversion } = await import(
            "~/lib/quote-part-mesh-converter.server"
          );
          const crypto = await import("crypto");

          // Convert File to Buffer
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Generate unique part number
          const partNumber = `QP-${Date.now()}-${crypto
            .randomBytes(4)
            .toString("hex")}`;

          // Sanitize filename for S3 (replace spaces and special chars)
          const sanitizedFileName = file.name
            .replace(/\s+/g, "-") // Replace spaces with hyphens
            .replace(/[^a-zA-Z0-9._-]/g, ""); // Remove any other special characters

          // Generate S3 key for the uploaded file
          const fileKey = `quote-parts/${crypto.randomUUID()}/source/${sanitizedFileName}`;

          // Upload to S3
          const uploadResult = await uploadFile({
            key: fileKey,
            buffer,
            contentType: file.type || "application/octet-stream",
            fileName: sanitizedFileName,
          });

          // Create quote part record
          const [newQuotePart] = await db
            .insert(quoteParts)
            .values({
              quoteId: quote.id,
              partNumber,
              partName: name,
              partFileUrl: uploadResult.key,
              conversionStatus: "pending",
            })
            .returning();

          quotePartId = newQuotePart.id;

          // Trigger mesh conversion asynchronously
          triggerQuotePartMeshConversion(
            newQuotePart.id,
            uploadResult.key
          ).catch(async (error) => {
            console.error(
              `Failed to trigger mesh conversion for quote part ${newQuotePart.id}:`,
              error
            );
            // Log error event for tracking
            const { createEvent } = await import("~/lib/events");
            await createEvent({
              entityType: "quote",
              entityId: quoteId,
              eventType: "mesh_conversion_failed",
              eventCategory: "system",
              title: "Mesh Conversion Failed",
              description: `Failed to trigger mesh conversion for part ${newQuotePart.partName}`,
              metadata: {
                quotePartId: newQuotePart.id,
                error: error instanceof Error ? error.message : String(error),
              },
              userId: eventContext?.userId,
              userEmail: eventContext?.userEmail,
            }).catch((err) => console.error("Failed to log event:", err));
          });

          // Handle technical drawings if provided
          const drawingCount =
            parseInt(formData.get("drawingCount") as string) || 0;
          if (drawingCount > 0) {
            const { attachments, quotePartDrawings } = await import(
              "~/lib/db/schema"
            );

            for (let i = 0; i < drawingCount; i++) {
              const drawing = formData.get(`drawing_${i}`) as File | null;
              if (drawing && drawing.size > 0) {
                // Convert drawing File to Buffer
                const drawingArrayBuffer = await drawing.arrayBuffer();
                const drawingBuffer = Buffer.from(drawingArrayBuffer);

                // Sanitize drawing filename
                const sanitizedDrawingName = drawing.name
                  .replace(/\s+/g, "-")
                  .replace(/[^a-zA-Z0-9._-]/g, "");

                // Upload drawing to S3
                const drawingKey = `quote-parts/${
                  newQuotePart.id
                }/drawings/${Date.now()}-${i}-${sanitizedDrawingName}`;
                const drawingUploadResult = await uploadFile({
                  key: drawingKey,
                  buffer: drawingBuffer,
                  contentType: drawing.type || "application/pdf",
                  fileName: sanitizedDrawingName,
                });

                // Create attachment record
                const [attachment] = await db
                  .insert(attachments)
                  .values({
                    s3Bucket: process.env.S3_BUCKET || "default-bucket",
                    s3Key: drawingUploadResult.key,
                    fileName: drawing.name,
                    contentType: drawing.type || "application/pdf",
                    fileSize: drawing.size,
                  })
                  .returning();

                // Link attachment to quote part
                await db.insert(quotePartDrawings).values({
                  quotePartId: newQuotePart.id,
                  attachmentId: attachment.id,
                  version: 1,
                });
              }
            }
          }
        }

        // Create quote line item with event context
        const { createQuoteLineItem } = await import("~/lib/quotes");
        await createQuoteLineItem(
          quote.id,
          {
            quotePartId: quotePartId || undefined,
            name: name || undefined,
            quantity: parseInt(quantity),
            unitPrice: parseFloat(unitPrice),
            description: description || undefined,
            notes: notes || undefined,
          },
          eventContext
        );

        // Recalculate totals
        const { calculateQuoteTotals } = await import("~/lib/quotes");
        await calculateQuoteTotals(quote.id);

        return redirect(`/quotes/${quoteId}`);
      } catch (error) {
        console.error("Error adding line item:", error);
        return json({ error: "Failed to add line item" }, { status: 500 });
      }
    }

    // Handle add drawing to existing part
    if (intent === "addDrawingToExistingPart") {
      const quotePartId = formData.get("quotePartId") as string;
      const drawingCount =
        parseInt(formData.get("drawingCount") as string) || 0;

      if (!quotePartId || drawingCount === 0) {
        return json(
          { error: "Missing quote part ID or drawings" },
          { status: 400 }
        );
      }

      try {
        const { attachments, quotePartDrawings } = await import(
          "~/lib/db/schema"
        );

        for (let i = 0; i < drawingCount; i++) {
          const drawing = formData.get(`drawing_${i}`) as File | null;
          if (drawing && drawing.size > 0) {
            // Convert drawing File to Buffer
            const drawingArrayBuffer = await drawing.arrayBuffer();
            const drawingBuffer = Buffer.from(drawingArrayBuffer);

            // Sanitize drawing filename
            const sanitizedDrawingName = drawing.name
              .replace(/\s+/g, "-")
              .replace(/[^a-zA-Z0-9._-]/g, "");

            // Upload drawing to S3
            const drawingKey = `quote-parts/${quotePartId}/drawings/${Date.now()}-${i}-${sanitizedDrawingName}`;
            const drawingUploadResult = await uploadFile({
              key: drawingKey,
              buffer: drawingBuffer,
              contentType: drawing.type || "application/pdf",
              fileName: sanitizedDrawingName,
            });

            // Create attachment record
            const [attachment] = await db
              .insert(attachments)
              .values({
                s3Bucket: process.env.S3_BUCKET || "default-bucket",
                s3Key: drawingUploadResult.key,
                fileName: drawing.name,
                contentType: drawing.type || "application/pdf",
                fileSize: drawing.size,
              })
              .returning();

            // Link attachment to quote part
            await db.insert(quotePartDrawings).values({
              quotePartId: quotePartId,
              attachmentId: attachment.id,
              version: 1,
            });
          }
        }

        return redirect(`/quotes/${quoteId}`);
      } catch (error) {
        console.error("Error adding drawings to existing part:", error);
        return json({ error: "Failed to add drawings" }, { status: 500 });
      }
    }

    // Handle regular file attachment upload (for quote attachments, not technical drawings)
    if (intent === "uploadAttachment" || !intent) {
      const file = formData.get("file") as File;

      if (!file) {
        return json({ error: "No file provided" }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return json({ error: "File size exceeds 10MB limit" }, { status: 400 });
      }

      try {
        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Generate S3 key
        const key = generateFileKey(quote.id, file.name);

        // Upload to S3
        const uploadResult = await uploadFile({
          key,
          buffer,
          contentType: file.type || "application/octet-stream",
          fileName: file.name,
        });

        // Create attachment record
        const attachment = await createAttachment(
          {
            s3Bucket: uploadResult.bucket,
            s3Key: uploadResult.key,
            fileName: uploadResult.fileName,
            contentType: uploadResult.contentType,
            fileSize: uploadResult.size,
          },
          eventContext
        );

        // Link to quote
        await db.insert(quoteAttachments).values({
          quoteId: quote.id,
          attachmentId: attachment.id,
        });

        // Return a redirect to refresh the page
        return redirect(`/quotes/${quoteId}`);
      } catch (error) {
        console.error("Upload error:", error);
        return json({ error: "Failed to upload file" }, { status: 500 });
      }
    }

    // If we get here with multipart data but unhandled intent, check if it's a PDF generation
    // PDF generation uses FormData but doesn't include files, so let it fall through
    const pdfGenerationIntents = ["generateQuote", "generateInvoice"];
    if (!pdfGenerationIntents.includes(intent as string)) {
      return json({ error: "Invalid multipart request" }, { status: 400 });
    }
    // Fall through to regular form handling for PDF generation
  } else {
    // Not multipart, parse as regular FormData
    formData = await request.formData();
  }

  // Handle form submissions
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "updateStatus": {
        const status = formData.get("status") as
          | "RFQ"
          | "Draft"
          | "Sent"
          | "Accepted"
          | "Rejected"
          | "Dropped"
          | "Expired";
        const rejectionReason = formData.get("rejectionReason") as string;

        // If status is Accepted, validate and convert to order BEFORE updating status
        if (status === "Accepted") {
          // Validate quote before conversion
          const validationErrors = [];

          // Check quote has valid pricing
          const quoteTotal = parseFloat(quote.total || '0');
          if (quoteTotal <= 0) {
            validationErrors.push("Quote must have a valid total greater than $0. Please add pricing to line items.");
          }

          // Check quote has line items
          if (!quote.lineItems || quote.lineItems.length === 0) {
            validationErrors.push("Quote must have at least one line item.");
          }

          // Check for pending mesh conversions
          if (quote.parts && quote.parts.length > 0) {
            const pendingConversions = quote.parts.filter(
              part => part.conversionStatus === 'in_progress' ||
              part.conversionStatus === 'queued' ||
              (part.conversionStatus === 'pending' && part.partFileUrl)
            );
            if (pendingConversions.length > 0) {
              validationErrors.push(`Cannot accept quote while ${pendingConversions.length} part(s) have pending mesh conversions.`);
            }
          }

          // If validation fails, return errors without changing status
          if (validationErrors.length > 0) {
            return json(
              {
                error: "Cannot accept quote",
                validationErrors
              },
              { status: 400 }
            );
          }

          // Attempt conversion
          const result = await convertQuoteToOrder(quote.id, eventContext);
          if (result.success && result.orderNumber) {
            // Conversion succeeded, redirect to order
            return redirect(`/orders/${result.orderNumber}`);
          }
          // Conversion failed, return error without changing status
          return json(
            { error: result.error || "Failed to convert quote to order" },
            { status: 400 }
          );
        }

        // For all other status changes, update normally
        await updateQuote(
          quote.id,
          {
            status,
            rejectionReason: status === "Rejected" ? rejectionReason : null,
          },
          eventContext
        );

        return redirect(`/quotes/${quoteId}`);
      }

      case "updateQuote": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const expirationDays = formData.get("expirationDays");

        const updates: { expirationDays?: number } = {};
        if (expirationDays !== null) {
          const days = parseInt(expirationDays as string);

          // Validate expiration days: must be between 1 and 365 days
          if (isNaN(days) || days < 1 || days > 365) {
            return json(
              { error: "Expiration days must be between 1 and 365" },
              { status: 400 }
            );
          }

          updates.expirationDays = days;
        }

        await updateQuote(quote.id, updates, eventContext);
        return json({ success: true });
      }

      case "updateCustomer": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const customerId = formData.get("customerId") as string;
        if (!customerId) {
          return json({ error: "Customer ID is required" }, { status: 400 });
        }

        await updateQuote(
          quote.id,
          { customerId: parseInt(customerId) },
          eventContext
        );
        return json({ success: true });
      }

      case "updateVendor": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const vendorId = formData.get("vendorId") as string;
        await updateQuote(
          quote.id,
          {
            vendorId: vendorId ? parseInt(vendorId) : null,
          },
          eventContext
        );
        return json({ success: true });
      }

      case "updateValidUntil": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const validUntil = formData.get("validUntil") as string;

        if (!validUntil) {
          return json(
            { error: "Valid until date is required" },
            { status: 400 }
          );
        }

        await updateQuote(
          quote.id,
          { validUntil: new Date(validUntil) },
          eventContext
        );
        return json({ success: true });
      }

      case "convertToOrder": {
        const result = await convertQuoteToOrder(quote.id, eventContext);
        if (result.success && result.orderNumber) {
          return redirect(`/orders/${result.orderNumber}`);
        }
        return json(
          { error: result.error || "Failed to convert quote" },
          { status: 400 }
        );
      }

      case "reviseQuote": {
        // Check if quote can be revised (Accepted quotes cannot be revised)
        const revisableStatuses = ["Sent", "Dropped", "Rejected", "Expired"];
        if (!revisableStatuses.includes(quote.status)) {
          return json(
            {
              error:
                "Only sent, dropped, rejected, or expired quotes can be revised. Accepted quotes are immutable.",
            },
            { status: 400 }
          );
        }

        // Store old status before updating
        const oldStatus = quote.status;

        // Manually update quote status to Draft without triggering automatic status change event
        await db
          .update(quotes)
          .set({
            status: "Draft",
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, quote.id));

        // Create custom revision event
        await createEvent({
          entityType: "quote",
          entityId: quote.id.toString(),
          eventType: "quote_revised",
          eventCategory: "status",
          title: "Quote Revised",
          description: `Quote was revised and reverted to Draft status from ${oldStatus}`,
          metadata: {
            oldStatus,
            newStatus: "Draft",
            quoteNumber: quote.quoteNumber,
          },
          userId: eventContext.userId,
          userEmail: eventContext.userEmail,
        });

        return redirect(`/quotes/${quoteId}`);
      }

      case "updateLineItem": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const lineItemId = formData.get("lineItemId") as string;

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        const { updateQuoteLineItem } = await import("~/lib/quotes");

        const updateData: {
          quantity?: number;
          unitPrice?: number;
          description?: string;
          notes?: string;
        } = {};

        // Get all possible updated fields
        const quantity = formData.get("quantity") as string | null;
        const unitPrice = formData.get("unitPrice") as string | null;
        const description = formData.get("description") as string | null;
        const notes = formData.get("notes") as string | null;

        // Only add fields that were provided (totalPrice is calculated automatically)
        if (quantity !== null) {
          updateData.quantity = parseInt(quantity);
        }
        if (unitPrice !== null) {
          updateData.unitPrice = parseFloat(unitPrice);
        }
        if (description !== null) {
          updateData.description = description || "";
        }
        if (notes !== null) {
          updateData.notes = notes || "";
        }

        await updateQuoteLineItem(
          parseInt(lineItemId),
          updateData,
          eventContext
        );

        // Totals are already recalculated by updateQuoteLineItem
        const { calculateQuoteTotals } = await import("~/lib/quotes");
        const updatedTotals = await calculateQuoteTotals(quote.id);

        // Return JSON response for fetcher to handle without navigation
        return json({ success: true, totals: updatedTotals });
      }

      case "archiveQuote": {
        await archiveQuote(quote.id, eventContext);
        return redirect("/quotes");
      }

      case "restoreQuote": {
        await restoreQuote(quote.id, eventContext);
        return redirect(`/quotes/${quote.id}`);
      }

      case "getNotes": {
        const notes = await getNotes("quote", quote.id.toString());
        return withAuthHeaders(json({ notes }), headers);
      }

      case "createNote": {
        const content = formData.get("content") as string;
        const createdBy = formData.get("createdBy") as string;

        if (!content || !createdBy) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const note = await createNote(
          {
            entityType: "quote",
            entityId: quote.id.toString(),
            content,
            createdBy,
          },
          noteEventContext
        );

        return withAuthHeaders(json({ note }), headers);
      }

      case "updateNote": {
        const noteId = formData.get("noteId") as string;
        const content = formData.get("content") as string;

        if (!noteId || !content) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const note = await updateNote(noteId, content, noteEventContext);
        return withAuthHeaders(json({ note }), headers);
      }

      case "deleteNote": {
        const noteId = formData.get("noteId") as string;

        if (!noteId) {
          return json({ error: "Missing note ID" }, { status: 400 });
        }

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await archiveNote(noteId, noteEventContext);
        return withAuthHeaders(json({ success: true }), headers);
      }

      case "deleteAttachment": {
        const attachmentId = formData.get("attachmentId") as string;

        if (!attachmentId) {
          return json({ error: "Missing attachment ID" }, { status: 400 });
        }

        // Unlink from quote
        await db
          .delete(quoteAttachments)
          .where(eq(quoteAttachments.attachmentId, attachmentId));

        // Get attachment to delete S3 file
        const attachment = await getAttachment(attachmentId);
        if (attachment) {
          await deleteFile(attachment.s3Key);

          const eventContext: AttachmentEventContext = {
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          };

          await deleteAttachment(attachmentId, eventContext);
        }

        return redirect(`/quotes/${quoteId}`);
      }

      case "deleteDrawing": {
        const drawingId = formData.get("drawingId") as string;
        const quotePartId = formData.get("quotePartId") as string;

        if (!drawingId || !quotePartId) {
          return json(
            { error: "Missing drawing or quote part ID" },
            { status: 400 }
          );
        }

        // Unlink drawing from quote part
        await db
          .delete(quotePartDrawings)
          .where(eq(quotePartDrawings.attachmentId, drawingId));

        // Get attachment to delete S3 file
        const attachment = await getAttachment(drawingId);
        if (attachment) {
          await deleteFile(attachment.s3Key);

          const eventContext: AttachmentEventContext = {
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          };

          await deleteAttachment(drawingId, eventContext);
        }

        return redirect(`/quotes/${quoteId}`);
      }

      case "deleteLineItem": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const lineItemId = formData.get("lineItemId") as string;
        const quotePartId = formData.get("quotePartId") as string;

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        try {
          // Helper function to sanitize S3 keys (same as upload logic)
          const sanitizeS3Key = (key: string): string => {
            return key
              .replace(/\s+/g, "-") // Replace spaces with hyphens
              .replace(/[^a-zA-Z0-9._/-]/g, ""); // Remove any other special characters except slashes
          };

          let quotePart = null;
          const filesToDelete: string[] = [];

          // If there's an associated quote part, get its details first
          if (quotePartId) {
            const { quoteParts } = await import("~/lib/db/schema");

            // Get the quote part details to find S3 files
            const [part] = await db
              .select()
              .from(quoteParts)
              .where(eq(quoteParts.id, quotePartId))
              .limit(1);

            quotePart = part;

            // Collect all S3 file keys to delete
            if (quotePart) {
              // Add source file (sanitize the key)
              if (quotePart.partFileUrl) {
                filesToDelete.push(sanitizeS3Key(quotePart.partFileUrl));
              }

              // Add mesh file
              if (quotePart.partMeshUrl) {
                const meshUrl = quotePart.partMeshUrl;
                if (meshUrl.includes("quote-parts/")) {
                  const urlParts = meshUrl.split("/");
                  const quotePartsIndex = urlParts.findIndex(
                    (p) => p === "quote-parts"
                  );
                  if (quotePartsIndex >= 0) {
                    const meshKey = urlParts.slice(quotePartsIndex).join("/");
                    filesToDelete.push(meshKey);
                  }
                }
              }

              // Add thumbnail file
              if (quotePart.thumbnailUrl) {
                filesToDelete.push(quotePart.thumbnailUrl);
              }
            }
          }

          // Step 1: Delete database records in transaction (atomic operation)
          await db.transaction(async (tx) => {
            const { deleteQuoteLineItem } = await import("~/lib/quotes");
            await deleteQuoteLineItem(parseInt(lineItemId), eventContext);

            // Delete quote part from database if it exists
            if (quotePart && quotePartId) {
              const { quoteParts } = await import("~/lib/db/schema");
              await tx.delete(quoteParts).where(eq(quoteParts.id, quotePartId));
            }
          });

          // Step 2: Delete S3 files AFTER successful database operations
          // If this fails, files become orphaned but database is consistent
          for (const fileKey of filesToDelete) {
            try {
              await deleteFile(fileKey);
              console.log(`Deleted S3 file: ${fileKey}`);
            } catch (error: unknown) {
              // Log but don't fail - database is already consistent
              const err = error as { Code?: string; name?: string };
              if (err?.Code === "NoSuchKey" || err?.name === "NoSuchKey") {
                console.log(`S3 file not found (already deleted?): ${fileKey}`);
              } else {
                console.error(`Error deleting S3 file ${fileKey}:`, error);
                // TODO: Add to cleanup queue for retry
              }
            }
          }

          // Recalculate quote totals
          const { calculateQuoteTotals } = await import("~/lib/quotes");
          await calculateQuoteTotals(quote.id);

          return redirect(`/quotes/${quoteId}`);
        } catch (error) {
          console.error("Error deleting line item:", error);
          return json({ error: "Failed to delete line item" }, { status: 500 });
        }
      }

      case "regenerateMesh": {
        const partId = formData.get("partId") as string;
        if (!partId) {
          return json({ error: "Part ID is required" }, { status: 400 });
        }

        // Get the quote part
        const { quoteParts } = await import("~/lib/db/schema");
        const [quotePart] = await db
          .select()
          .from(quoteParts)
          .where(eq(quoteParts.id, partId))
          .limit(1);

        if (!quotePart) {
          return json({ error: "Quote part not found" }, { status: 404 });
        }

        if (!quotePart.partFileUrl) {
          return json(
            { error: "No source file available for conversion" },
            { status: 400 }
          );
        }

        // Trigger mesh conversion
        const { triggerQuotePartMeshConversion } = await import(
          "~/lib/quote-part-mesh-converter.server"
        );

        // Reset conversion status to pending
        await db
          .update(quoteParts)
          .set({
            conversionStatus: "pending",
            meshConversionError: null,
            updatedAt: new Date(),
          })
          .where(eq(quoteParts.id, partId));

        // Trigger conversion asynchronously
        triggerQuotePartMeshConversion(
          quotePart.id,
          quotePart.partFileUrl
        ).catch(async (error) => {
          console.error(
            `Failed to regenerate mesh for quote part ${quotePart.id}:`,
            error
          );
          // Log error event for tracking
          const { createEvent } = await import("~/lib/events");
          await createEvent({
            entityType: "quote",
            entityId: quoteId,
            eventType: "mesh_conversion_failed",
            eventCategory: "system",
            title: "Mesh Regeneration Failed",
            description: `Failed to regenerate mesh for part ${quotePart.partName}`,
            metadata: {
              quotePartId: quotePart.id,
              error: error instanceof Error ? error.message : String(error),
            },
            userId: eventContext?.userId,
            userEmail: eventContext?.userEmail,
          }).catch((err) => console.error("Failed to log event:", err));
        });

        return json({ success: true });
      }

      case "savePriceCalculation": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const calculationDataStr = formData.get("calculationData") as string;

        if (!calculationDataStr) {
          return json({ error: "Missing calculation data" }, { status: 400 });
        }

        const calculationData = JSON.parse(calculationDataStr);

        // Create the price calculation record
        await createPriceCalculation(
          calculationData,
          user?.id || userDetails?.id
        );

        return json({ success: true });
      }

      case "generateQuote": {
        const htmlContent = formData.get("htmlContent") as string;

        if (!htmlContent) {
          return json({ error: "Missing HTML content" }, { status: 400 });
        }

        try {
          const { attachmentId } = await generateDocumentPdf({
            entityType: "quote",
            entityId: quote.id,
            htmlContent,
            filename: `Quote-${quote.quoteNumber}.pdf`,
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          });

          // Get the attachment record to get the S3 key
          const attachment = await db
            .select()
            .from(attachments)
            .where(eq(attachments.id, attachmentId))
            .limit(1);

          if (!attachment[0]) {
            throw new Error("Failed to create attachment");
          }

          // Generate a signed download URL
          const downloadUrl = await getDownloadUrl(attachment[0].s3Key, 3600); // 1 hour expiry

          return json({
            success: true,
            downloadUrl,
            attachmentId,
            filename: `Quote-${quote.quoteNumber}.pdf`,
          });
        } catch (pdfError) {
          console.error("PDF generation failed:", pdfError);
          return json({
            error: pdfError instanceof Error ? pdfError.message : "Failed to generate PDF"
          }, { status: 500 });
        }
      }

      case "generateInvoice": {
        const htmlContent = formData.get("htmlContent") as string;

        if (!htmlContent) {
          return json({ error: "Missing HTML content" }, { status: 400 });
        }

        try {
          const { attachmentId } = await generateDocumentPdf({
            entityType: "quote",
            entityId: quote.id,
            htmlContent,
            filename: `Invoice-${quote.quoteNumber}.pdf`,
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          });

          // Get the attachment record to get the S3 key
          const attachment = await db
            .select()
            .from(attachments)
            .where(eq(attachments.id, attachmentId))
            .limit(1);

          if (!attachment[0]) {
            throw new Error("Failed to create attachment");
          }

          // Generate a signed download URL
          const downloadUrl = await getDownloadUrl(attachment[0].s3Key, 3600); // 1 hour expiry

          return json({
            success: true,
            downloadUrl,
            attachmentId,
            filename: `Invoice-${quote.quoteNumber}.pdf`,
          });
        } catch (pdfError) {
          console.error("PDF generation failed:", pdfError);
          return json({
            error: pdfError instanceof Error ? pdfError.message : "Failed to generate PDF"
          }, { status: 500 });
        }
      }

      default:
        return json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: "An error occurred" }, { status: 500 });
  }
}

export default function QuoteDetail() {
  const {
    quote,
    customer,
    vendor,
    customers,
    vendors,
    notes,
    attachments,
    user,
    userDetails,
    priceCalculations,
    appConfig,
    showEventsLink,
    showVersionInHeader,
    canAccessPriceCalculator,
    pdfAutoDownload,
    rejectionReasonRequired,
    events,
    convertedOrder,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    type: string;
    fileName: string;
    contentType?: string;
    fileSize?: number;
  } | null>(null);
  const [isFileViewerOpen, setIsFileViewerOpen] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [isPartsModalOpen, setIsPartsModalOpen] = useState(false);
  const [isAddLineItemModalOpen, setIsAddLineItemModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editingVendor, setEditingVendor] = useState(false);
  // Define the line item type
  type LineItem = {
    id: number;
    quotePartId: string | null;
    name: string | null;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    leadTimeDays: number | null;
    description: string | null;
    notes: string | null;
  };

  const [editingLineItem, setEditingLineItem] = useState<{
    id: number;
    field: "quantity" | "unitPrice" | "totalPrice" | "description" | "notes";
    value: string;
  } | null>(null);
  const [optimisticLineItems, setOptimisticLineItems] = useState<
    LineItem[] | undefined
  >(quote.lineItems as LineItem[] | undefined);
  const [optimisticTotal, setOptimisticTotal] = useState(quote.total || "0.00");
  const [editingExpirationDays, setEditingExpirationDays] = useState(false);
  const [expirationDaysValue, setExpirationDaysValue] = useState(
    (quote.expirationDays || 14).toString()
  );
  const [editingValidUntil, setEditingValidUntil] = useState(false);
  const [validUntilValue, setValidUntilValue] = useState(
    quote.validUntil
      ? new Date(quote.validUntil).toISOString().split("T")[0]
      : ""
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const lineItemFetcher = useFetcher();
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [currentCalculatorPartIndex, setCurrentCalculatorPartIndex] = useState(0);
  const calculatorFetcher = useFetcher();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isGeneratePdfModalOpen, setIsGeneratePdfModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [part3DModalOpen, setPart3DModalOpen] = useState(false);
  const [selectedPart3D, setSelectedPart3D] = useState<{
    partId: string;
    partName: string;
    modelUrl?: string;
    solidModelUrl?: string;
    thumbnailUrl?: string;
  } | null>(null);

  // Check if quote is in a locked state (sent or beyond)
  const isQuoteLocked = ["Sent", "Accepted", "Rejected", "Expired"].includes(
    quote.status
  );

  // Check if any parts are currently converting
  const hasConvertingParts = quote.parts?.some(
    (part: { conversionStatus: string | null }) =>
      part.conversionStatus === "in_progress" ||
      part.conversionStatus === "queued" ||
      part.conversionStatus === "pending"
  );

  // Set up polling for parts conversion status
  useEffect(() => {
    const MAX_POLL_COUNT = 120; // Max 10 minutes (120 * 5 seconds)

    if (hasConvertingParts && !pollInterval && pollCount < MAX_POLL_COUNT) {
      const interval = setInterval(() => {
        setPollCount((prev) => prev + 1);
        // Revalidate the page data to get updated conversion status
        revalidator.revalidate();
      }, 5000); // Poll every 5 seconds
      setPollInterval(interval);
    } else if (!hasConvertingParts && pollInterval) {
      // Conversion completed - clear interval and reset count
      clearInterval(pollInterval);
      setPollInterval(null);
      setPollCount(0);
    } else if (pollCount >= MAX_POLL_COUNT && pollInterval) {
      // Timeout reached - stop polling
      console.warn("Mesh conversion polling timeout reached (10 minutes)");
      clearInterval(pollInterval);
      setPollInterval(null);
      setPollCount(0);
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [hasConvertingParts, pollInterval, pollCount, revalidator]);

  // Update optimistic line items when the actual data changes
  useEffect(() => {
    setOptimisticLineItems(quote.lineItems as LineItem[] | undefined);
    setOptimisticTotal(quote.total || "0.00");
  }, [quote.lineItems, quote.total]);

  // Calculate optimistic total whenever line items change
  useEffect(() => {
    if (optimisticLineItems && optimisticLineItems.length > 0) {
      const total = optimisticLineItems.reduce(
        (sum: number, item: LineItem) => {
          const itemTotal = parseFloat(item.totalPrice) || 0;
          return sum + itemTotal;
        },
        0
      );
      setOptimisticTotal(total.toFixed(2));
    }
  }, [optimisticLineItems]);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("file", file);

      fetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [fetcher]
  );

  const handleViewFile = (attachment: {
    downloadUrl: string;
    fileName: string;
    id: string;
    contentType?: string;
    fileSize?: number;
  }) => {
    if (isViewableFile(attachment.fileName)) {
      setSelectedFile({
        url: attachment.downloadUrl,
        type: getFileType(attachment.fileName).type,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        fileSize: attachment.fileSize,
      });
      setIsFileViewerOpen(true);
    } else {
      // Download non-viewable files
      window.open(attachment.downloadUrl, "_blank");
    }
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (confirm("Are you sure you want to delete this attachment?")) {
      fetcher.submit(
        { intent: "deleteAttachment", attachmentId },
        { method: "post" }
      );
    }
  };

  const handleView3DModel = (part: {
    id: string;
    partName: string;
    signedMeshUrl?: string;
    signedFileUrl?: string;
    signedThumbnailUrl?: string;
  }) => {
    if (part.signedMeshUrl) {
      setSelectedPart3D({
        partId: part.id,
        partName: part.partName,
        modelUrl: part.signedMeshUrl,
        solidModelUrl: part.signedFileUrl,
        thumbnailUrl: part.signedThumbnailUrl,
      });
      setPart3DModalOpen(true);
    }
  };

  const handleReviseQuote = () => {
    if (
      confirm(
        "Are you sure you want to revise this quote? This will revert the quote to Draft status and allow editing again."
      )
    ) {
      fetcher.submit({ intent: "reviseQuote" }, { method: "post" });
    }
  };

  const handleSendQuote = () => {
    if (
      confirm(
        "Are you sure you want to send this quote? Once sent, the quote will be locked and line items cannot be modified."
      )
    ) {
      fetcher.submit(
        {
          intent: "updateStatus",
          status: "Sent",
          rejectionReason: "",
        },
        { method: "post" }
      );
    }
  };

  const handleMarkAsAccepted = () => {
    if (
      confirm(
        "Are you sure you want to mark this quote as accepted? This will automatically convert the quote to an order and the quote will become permanently immutable."
      )
    ) {
      fetcher.submit(
        {
          intent: "updateStatus",
          status: "Accepted",
          rejectionReason: "",
        },
        { method: "post" }
      );
    }
  };

  const handleRejectQuote = () => {
    setIsRejectModalOpen(true);
  };

  const handleRejectQuoteConfirm = () => {
    if (rejectionReasonRequired && !rejectionReason.trim()) {
      alert("Rejection reason is required.");
      return;
    }

    fetcher.submit(
      {
        intent: "updateStatus",
        status: "Rejected",
        rejectionReason: rejectionReason.trim(),
      },
      { method: "post" }
    );
    setIsRejectModalOpen(false);
    setRejectionReason("");
  };

  const handleRejectModalClose = () => {
    setIsRejectModalOpen(false);
    setRejectionReason("");
  };

  const handleAddLineItem = () => {
    setIsAddLineItemModalOpen(true);
  };

  const handleAddLineItemSubmit = (formData: FormData) => {
    formData.append("intent", "addLineItem");
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const handleOpenCalculator = () => {
    if (!canAccessPriceCalculator) return;
    setIsCalculatorOpen(true);
    setCurrentCalculatorPartIndex(0);
  };

  const handleGeneratePdf = () => {
    setIsGeneratePdfModalOpen(true);
  };

  const handleGenerateInvoice = () => {
    setIsInvoiceModalOpen(true);
  };

  const handleOpenCalculatorForPart = (partId: string) => {
    if (!canAccessPriceCalculator) return;
    // Find the index of the part in the quote.parts array
    const partIndex = quote.parts?.findIndex((p: { id: string }) => p.id === partId) ?? 0;
    setCurrentCalculatorPartIndex(partIndex);
    setIsCalculatorOpen(true);
  };

  const handleDownloadFiles = async () => {
    setIsDownloading(true);

    try {
      const downloadUrl = `/quotes/${quote.id}/download`;
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error("Failed to download files");
      }

      // Get the blob from the response
      const blob = await response.blob();

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = `Quote-${quote.quoteNumber}-Files.zip`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create a download link and trigger it
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download error:", error);
      alert("Failed to download files. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveCalculation = (calculationData: Record<string, unknown>) => {
    const formData = new FormData();
    formData.append("intent", "savePriceCalculation");
    formData.append("calculationData", JSON.stringify(calculationData));

    calculatorFetcher.submit(formData, {
      method: "post",
    });

    // If this is the last part, close the modal
    if (currentCalculatorPartIndex >= (quote.parts?.length || 1) - 1) {
      setIsCalculatorOpen(false);
      // Revalidate to get the updated prices
      revalidator.revalidate();
    }
  };

  const handleDeleteLineItem = (lineItemId: number, quotePartId?: string) => {
    if (
      confirm(
        "Are you sure you want to delete this line item? This will also delete any associated files and cannot be undone."
      )
    ) {
      fetcher.submit(
        {
          intent: "deleteLineItem",
          lineItemId: lineItemId.toString(),
          quotePartId: quotePartId || "",
        },
        { method: "post" }
      );
    }
  };

  const startEditingLineItem = (
    itemId: number,
    field: "quantity" | "unitPrice" | "totalPrice" | "description" | "notes",
    currentValue: string | number | null
  ) => {
    const value =
      field === "notes" || field === "description"
        ? (currentValue || "").toString()
        : field === "quantity"
        ? currentValue?.toString() || ""
        : currentValue?.toString().replace(/[^0-9.]/g, "") || "";
    setEditingLineItem({ id: itemId, field, value });
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
        if (field !== "notes" && field !== "description") {
          editInputRef.current.select();
        }
      }
    }, 0);
  };

  const cancelEditingLineItem = () => {
    setEditingLineItem(null);
  };

  const saveLineItemEdit = () => {
    if (!editingLineItem) return;

    // Find the current item
    const currentItem = optimisticLineItems?.find(
      (item) => item.id === editingLineItem.id
    );
    if (!currentItem) return;

    // Validate and calculate related values
    const updatedItem: Partial<LineItem> = {};

    if (editingLineItem.field === "description") {
      // Update description (no validation needed)
      updatedItem.description = editingLineItem.value || null;
    } else if (editingLineItem.field === "notes") {
      // Update notes (no validation needed)
      updatedItem.notes = editingLineItem.value || null;
    } else if (editingLineItem.field === "quantity") {
      const qty = parseInt(editingLineItem.value);
      if (isNaN(qty) || qty <= 0) {
        alert("Please enter a valid quantity");
        return;
      }

      // Update quantity and recalculate total based on unit price
      updatedItem.quantity = qty;
      const unitPrice = parseFloat(currentItem.unitPrice);
      if (!isNaN(unitPrice)) {
        updatedItem.totalPrice = (qty * unitPrice).toFixed(2);
      }
    } else if (editingLineItem.field === "unitPrice") {
      const unitPrice = parseFloat(editingLineItem.value);
      if (isNaN(unitPrice) || unitPrice < 0) {
        alert("Please enter a valid price");
        return;
      }

      // Update unit price and recalculate total based on quantity
      updatedItem.unitPrice = unitPrice.toFixed(2);
      updatedItem.totalPrice = (currentItem.quantity * unitPrice).toFixed(2);
    } else if (editingLineItem.field === "totalPrice") {
      const totalPrice = parseFloat(editingLineItem.value);
      if (isNaN(totalPrice) || totalPrice < 0) {
        alert("Please enter a valid price");
        return;
      }

      // Update total price and recalculate unit price based on quantity
      updatedItem.totalPrice = totalPrice.toFixed(2);
      if (currentItem.quantity > 0) {
        updatedItem.unitPrice = (totalPrice / currentItem.quantity).toFixed(2);
      }
    }

    // Optimistically update the line items with all calculated values
    setOptimisticLineItems((prevItems) =>
      prevItems?.map((item) =>
        item.id === editingLineItem.id ? { ...item, ...updatedItem } : item
      )
    );

    // Submit all updated values to the backend
    const formData = new FormData();
    formData.append("intent", "updateLineItem");
    formData.append("lineItemId", editingLineItem.id.toString());

    // Send all updated fields to the backend
    if (updatedItem.description !== undefined) {
      formData.append("description", updatedItem.description || "");
    }
    if (updatedItem.notes !== undefined) {
      formData.append("notes", updatedItem.notes || "");
    }
    if (updatedItem.quantity !== undefined) {
      formData.append("quantity", updatedItem.quantity.toString());
    }
    if (updatedItem.unitPrice !== undefined) {
      formData.append("unitPrice", updatedItem.unitPrice);
    }
    if (updatedItem.totalPrice !== undefined) {
      formData.append("totalPrice", updatedItem.totalPrice);
    }

    lineItemFetcher.submit(formData, { method: "post" });
    setEditingLineItem(null);
  };

  const handleLineItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveLineItemEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditingLineItem();
    }
  };

  // Format currency
  const formatCurrency = (amount: string | null) => {
    if (!amount) return "$0.00";
    return `$${parseFloat(amount).toFixed(2)}`;
  };

  // Format date
  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
  };

  // Format date and time in local timezone
  const formatDateTime = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleString("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Calculate days until expiry
  const validUntil = quote.validUntil ? new Date(quote.validUntil) : null;
  const today = new Date();
  const daysUntilExpiry = validUntil
    ? Math.ceil(
        (validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;

  // Get status color classes
  const getStatusClasses = (status: string) => {
    switch (status.toLowerCase()) {
      case "rfq":
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
      case "draft":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
      case "sent":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
      case "accepted":
        return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
      case "rejected":
        return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
      case "dropped":
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
      case "expired":
        return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={
          userDetails?.name?.charAt(0).toUpperCase() ||
          user.email.charAt(0).toUpperCase()
        }
        version={appConfig.version}
        showVersion={showVersionInHeader}
        showEventsLink={showEventsLink}
      />

      <div className="max-w-[1920px] mx-auto">
        {/* Custom breadcrumb bar with buttons */}
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/" },
              { label: "Quotes", href: "/quotes" },
              { label: quote.quoteNumber },
            ]}
          />
          <div className="flex flex-wrap gap-3">
            {!quote.isArchived && (
              <>
                <div className="relative">
                  <Button
                    ref={actionsButtonRef}
                    onClick={() =>
                      setIsActionsDropdownOpen(!isActionsDropdownOpen)
                    }
                    variant="secondary"
                  >
                    Actions
                  </Button>
                  <QuoteActionsDropdown
                    isOpen={isActionsDropdownOpen}
                    onClose={() => setIsActionsDropdownOpen(false)}
                    excludeRef={actionsButtonRef}
                    quoteStatus={quote.status}
                    onReviseQuote={handleReviseQuote}
                    onCalculatePricing={canAccessPriceCalculator ? handleOpenCalculator : undefined}
                    onDownloadFiles={handleDownloadFiles}
                    onGeneratePdf={handleGeneratePdf}
                    onGenerateInvoice={handleGenerateInvoice}
                    isDownloading={isDownloading}
                    hasCustomer={!!quote.customerId}
                  />
                </div>
                {(quote.status === "RFQ" || quote.status === "Draft") && (
                  <Button onClick={handleSendQuote} variant="primary">
                    Send Quote
                  </Button>
                )}
                {quote.status === "Sent" && !quote.convertedToOrderId && (
                  <>
                    <Button onClick={handleMarkAsAccepted} variant="primary">
                      Mark as Accepted
                    </Button>
                    <Button onClick={handleRejectQuote} variant="danger">
                      Reject Quote
                    </Button>
                  </>
                )}
              </>
            )}
            {/* No action buttons for archived quotes - restore button is in the banner */}
          </div>
        </div>

        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">
          {/* Error Banner */}
          {fetcher.data && typeof fetcher.data === 'object' && 'error' in fetcher.data && fetcher.data.error && (
            <div className="relative bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="w-6 h-6 flex-shrink-0 text-red-600 dark:text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold text-red-800 dark:text-red-200">
                    {(fetcher.data as { error: string }).error}
                  </p>
                  {'validationErrors' in fetcher.data && Array.isArray(fetcher.data.validationErrors) && fetcher.data.validationErrors.length > 0 && (
                    <ul className="mt-2 text-sm text-red-700 dark:text-red-300 list-disc list-inside space-y-1">
                      {(fetcher.data.validationErrors as string[]).map((error: string, index: number) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Archived Quote Banner */}
          {quote.isArchived && (
            <div className="relative bg-gray-900 dark:bg-gray-950 border-2 border-gray-700 dark:border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <svg
                  className="w-6 h-6 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                  />
                </svg>
                <div>
                  <p className="font-semibold text-gray-100">
                    This quote has been archived
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Locked Quote Banner */}
          {(quote.status === "Sent" || quote.status === "Accepted") &&
            !quote.isArchived && (
              <div
                className={`relative border-2 rounded-lg p-4 ${
                  quote.status === "Accepted"
                    ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
                    : "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700"
                }`}
              >
                <div className="flex items-start gap-3">
                  <svg
                    className={`w-6 h-6 flex-shrink-0 ${
                      quote.status === "Accepted"
                        ? "text-green-600 dark:text-green-400"
                        : "text-blue-600 dark:text-blue-400"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p
                      className={`font-semibold ${
                        quote.status === "Accepted"
                          ? "text-green-800 dark:text-green-200"
                          : "text-blue-800 dark:text-blue-200"
                      }`}
                    >
                      {quote.status === "Accepted"
                        ? "Quote Accepted"
                        : "Quote Sent"}
                    </p>
                    <p
                      className={`text-sm mt-1 ${
                        quote.status === "Accepted"
                          ? "text-green-700 dark:text-green-300"
                          : "text-blue-700 dark:text-blue-300"
                      }`}
                    >
                      {quote.status === "Accepted"
                        ? "Accepted quotes are immutable."
                        : "Sent Quotes are locked from editing. To make revisions, use the Revise Action."}
                    </p>
                  </div>
                </div>
              </div>
            )}

          {/* Expiry Notice Bar */}
          {daysUntilExpiry &&
            daysUntilExpiry > 0 &&
            daysUntilExpiry <= 7 &&
            quote.status === "Sent" &&
            !quote.isArchived && (
              <div className="relative bg-yellow-100 dark:bg-yellow-900/50 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
                <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                  Attention: This quote expires in {daysUntilExpiry} days
                </p>
              </div>
            )}

          {/* Status Cards - Always at top */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Quote Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Quote Status
              </h3>
              <div
                className={`px-4 py-3 rounded-full text-center font-semibold ${
                  quote.isArchived
                    ? "bg-gray-900 text-gray-100 dark:bg-gray-950 dark:text-gray-300"
                    : getStatusClasses(quote.status)
                }`}
              >
                {quote.isArchived
                  ? "Archived"
                  : quote.status.charAt(0).toUpperCase() +
                    quote.status.slice(1)}
              </div>
            </div>

            {/* Valid Until / Expiration Days / Accepted Date Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              {quote.status === "Accepted" ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Accepted
                  </h3>
                  <div className="relative">
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {quote.acceptedAt
                        ? new Date(quote.acceptedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })
                        : "--"}
                    </p>
                    {quote.acceptedAt &&
                      (() => {
                        const acceptedDate = new Date(quote.acceptedAt);
                        const now = new Date();
                        const diffMs = now.getTime() - acceptedDate.getTime();
                        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffDays = Math.floor(diffHours / 24);
                        const remainingHours = diffHours % 24;

                        let timeElapsed = "";
                        if (diffDays > 0) {
                          timeElapsed = `${diffDays} day${
                            diffDays > 1 ? "s" : ""
                          }${
                            remainingHours > 0
                              ? `, ${remainingHours} hour${
                                  remainingHours > 1 ? "s" : ""
                                }`
                              : ""
                          } ago`;
                        } else if (diffHours > 0) {
                          timeElapsed = `${diffHours} hour${
                            diffHours > 1 ? "s" : ""
                          } ago`;
                        } else {
                          const diffMins = Math.floor(diffMs / (1000 * 60));
                          timeElapsed =
                            diffMins > 0
                              ? `${diffMins} minute${
                                  diffMins > 1 ? "s" : ""
                                } ago`
                              : "Just now";
                        }

                        return (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {timeElapsed}
                          </p>
                        );
                      })()}
                  </div>
                </>
              ) : quote.status === "Sent" ||
                quote.status === "Rejected" ||
                quote.status === "Dropped" ||
                quote.status === "Expired" ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Valid Until
                  </h3>
                  <div className="relative">
                    {editingValidUntil ? (
                      <input
                        ref={(input) => {
                          if (input && editingValidUntil) {
                            input.focus();
                          }
                        }}
                        type="date"
                        className="w-full px-3 py-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        value={validUntilValue}
                        onChange={(e) => setValidUntilValue(e.target.value)}
                        onBlur={() => {
                          if (validUntilValue) {
                            fetcher.submit(
                              {
                                intent: "updateValidUntil",
                                validUntil: validUntilValue,
                              },
                              { method: "post" }
                            );
                          }
                          setEditingValidUntil(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (validUntilValue) {
                              fetcher.submit(
                                {
                                  intent: "updateValidUntil",
                                  validUntil: validUntilValue,
                                },
                                { method: "post" }
                              );
                            }
                            setEditingValidUntil(false);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setValidUntilValue(
                              quote.validUntil
                                ? new Date(quote.validUntil)
                                    .toISOString()
                                    .split("T")[0]
                                : ""
                            );
                            setEditingValidUntil(false);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {formatDate(quote.validUntil)}
                        </p>
                        {daysUntilExpiry !== null && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {daysUntilExpiry > 0
                              ? `${daysUntilExpiry} days remaining`
                              : "Expired"}
                          </p>
                        )}
                        <button
                          onClick={() => setEditingValidUntil(true)}
                          className="absolute -top-2 -right-2 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                          aria-label="Edit expiration date"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Expiration Days
                  </h3>
                  <div className="relative">
                    <div
                      className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 -mx-2 transition-colors"
                      onClick={() => {
                        setEditingExpirationDays(true);
                        setTimeout(() => {
                          const input = document.getElementById(
                            "expiration-days-input-chip"
                          );
                          if (input) {
                            (input as HTMLInputElement).focus();
                            (input as HTMLInputElement).select();
                          }
                        }, 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditingExpirationDays(true);
                          setTimeout(() => {
                            const input = document.getElementById(
                              "expiration-days-input-chip"
                            );
                            if (input) {
                              (input as HTMLInputElement).focus();
                              (input as HTMLInputElement).select();
                            }
                          }, 0);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {editingExpirationDays ? (
                        <div className="flex items-center gap-2">
                          <input
                            id="expiration-days-input-chip"
                            type="number"
                            className="w-20 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            value={expirationDaysValue}
                            onChange={(e) =>
                              setExpirationDaysValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const days = parseInt(expirationDaysValue);
                                if (!isNaN(days) && days > 0) {
                                  fetcher.submit(
                                    {
                                      intent: "updateQuote",
                                      expirationDays: expirationDaysValue,
                                    },
                                    { method: "post" }
                                  );
                                  setEditingExpirationDays(false);
                                }
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString()
                                );
                                setEditingExpirationDays(false);
                              }
                            }}
                            onBlur={() => {
                              const days = parseInt(expirationDaysValue);
                              if (
                                !isNaN(days) &&
                                days > 0 &&
                                days !== (quote.expirationDays || 14)
                              ) {
                                fetcher.submit(
                                  {
                                    intent: "updateQuote",
                                    expirationDays: expirationDaysValue,
                                  },
                                  { method: "post" }
                                );
                              } else {
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString()
                                );
                              }
                              setEditingExpirationDays(false);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            min="1"
                          />
                          <span className="text-base font-medium text-gray-900 dark:text-gray-100">
                            days
                          </span>
                        </div>
                      ) : (
                        <>
                          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {quote.expirationDays || 14} days
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Quote Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Quote Value
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(optimisticTotal)}
              </p>
            </div>

            {/* Customer Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Customer
              </h3>
              {!isQuoteLocked ? (
                <div>
                  {editingCustomer ? (
                    <select
                      value={quote.customerId?.toString() || ""}
                      onChange={(e) => {
                        const customerId = e.target.value;
                        if (customerId) {
                          fetcher.submit(
                            { intent: "updateCustomer", customerId },
                            { method: "post" }
                          );
                          setEditingCustomer(false);
                        }
                      }}
                      onBlur={() => setEditingCustomer(false)}
                      className="w-full px-3 py-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                    >
                      {customers.map(
                        (c: { id: number; displayName: string }) => (
                          <option key={c.id} value={c.id}>
                            {c.displayName}
                          </option>
                        )
                      )}
                    </select>
                  ) : (
                    <div
                      onClick={() => setEditingCustomer(true)}
                      className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 -mx-2 transition-colors"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditingCustomer(true);
                        }
                      }}
                    >
                      <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                        {customer?.displayName || "N/A"}
                      </p>
                      {customer?.email && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {customer.email}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {customer?.displayName || "N/A"}
                  </p>
                  {customer?.email && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {customer.email}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quote Details Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Quote Details
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Quote Number
                  </p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                    {quote.quoteNumber}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Created Date
                  </p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                    {formatDateTime(quote.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expiration Days
                  </p>
                  {!isQuoteLocked ? (
                    <div
                      className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 -mx-2 transition-colors"
                      onClick={() => {
                        setEditingExpirationDays(true);
                        setTimeout(() => {
                          const input = document.getElementById(
                            "expiration-days-input"
                          );
                          if (input) {
                            (input as HTMLInputElement).focus();
                            (input as HTMLInputElement).select();
                          }
                        }, 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditingExpirationDays(true);
                          setTimeout(() => {
                            const input = document.getElementById(
                              "expiration-days-input"
                            );
                            if (input) {
                              (input as HTMLInputElement).focus();
                              (input as HTMLInputElement).select();
                            }
                          }, 0);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {editingExpirationDays ? (
                        <div className="flex items-center gap-2">
                          <input
                            id="expiration-days-input"
                            type="number"
                            className="w-20 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            value={expirationDaysValue}
                            onChange={(e) =>
                              setExpirationDaysValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const days = parseInt(expirationDaysValue);
                                if (!isNaN(days) && days > 0) {
                                  fetcher.submit(
                                    {
                                      intent: "updateQuote",
                                      expirationDays: expirationDaysValue,
                                    },
                                    { method: "post" }
                                  );
                                  setEditingExpirationDays(false);
                                }
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString()
                                );
                                setEditingExpirationDays(false);
                              }
                            }}
                            onBlur={() => {
                              const days = parseInt(expirationDaysValue);
                              if (
                                !isNaN(days) &&
                                days > 0 &&
                                days !== (quote.expirationDays || 14)
                              ) {
                                fetcher.submit(
                                  {
                                    intent: "updateQuote",
                                    expirationDays: expirationDaysValue,
                                  },
                                  { method: "post" }
                                );
                              } else {
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString()
                                );
                              }
                              setEditingExpirationDays(false);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            min="1"
                          />
                          <span className="text-base font-medium text-gray-900 dark:text-gray-100">
                            days
                          </span>
                        </div>
                      ) : (
                        <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                          {quote.expirationDays || 14} days
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {quote.expirationDays || 14} days
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Vendor
                  </p>
                  {!isQuoteLocked ? (
                    editingVendor ? (
                      <select
                        value={quote.vendorId?.toString() || ""}
                        onChange={(e) => {
                          const vendorId = e.target.value;
                          fetcher.submit(
                            { intent: "updateVendor", vendorId },
                            { method: "post" }
                          );
                          setEditingVendor(false);
                        }}
                        onBlur={() => setEditingVendor(false)}
                        className="w-full px-3 py-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">No Vendor</option>
                        {vendors.map(
                          (v: { id: number; displayName: string }) => (
                            <option key={v.id} value={v.id}>
                              {v.displayName}
                            </option>
                          )
                        )}
                      </select>
                    ) : (
                      <div
                        onClick={() => setEditingVendor(true)}
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 -mx-2 transition-colors"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setEditingVendor(true);
                          }
                        }}
                      >
                        <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                          {vendor?.displayName || "None"}
                        </p>
                      </div>
                    )
                  ) : (
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {vendor?.displayName || "None"}
                    </p>
                  )}
                </div>
                {quote.sentAt && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Sent Date
                    </p>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {formatDateTime(quote.sentAt)}
                    </p>
                  </div>
                )}
                {quote.acceptedAt && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Accepted Date
                    </p>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {formatDateTime(quote.acceptedAt)}
                    </p>
                  </div>
                )}
                {quote.convertedToOrderId && convertedOrder && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Converted to Order
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.location.href = `/orders/${convertedOrder.orderNumber}`;
                      }}
                      className="text-base font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                    >
                      {convertedOrder.orderNumber}
                    </button>
                  </div>
                )}
                {quote.rejectionReason && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Rejection Reason
                    </p>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {quote.rejectionReason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Line Items Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Line Items
              </h3>
              <div className="flex gap-2">
                {quote.parts && quote.parts.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsPartsModalOpen(true)}
                  >
                    View Parts ({quote.parts.length})
                  </Button>
                )}
                {!isQuoteLocked && (
                  <Button size="sm" onClick={handleAddLineItem}>
                    Add Line Item
                  </Button>
                )}
              </div>
            </div>
            <div className="p-6">
              {optimisticLineItems && optimisticLineItems.length > 0 ? (
                <table className={tableStyles.container}>
                  <thead className={tableStyles.header}>
                    <tr>
                      <th className={tableStyles.headerCell}>Name</th>
                      <th className={tableStyles.headerCell}>Description</th>
                      <th className={tableStyles.headerCell}>Notes</th>
                      <th className={tableStyles.headerCell}>Quantity</th>
                      <th className={tableStyles.headerCell}>Unit Price</th>
                      <th className={tableStyles.headerCell}>Total Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimisticLineItems.map((item) => {
                      const part = quote.parts?.find(
                        (p: {
                          id: string;
                          partName: string;
                          signedThumbnailUrl?: string;
                          thumbnailUrl?: string | null;
                          conversionStatus?: string | null;
                          partFileUrl?: string | null;
                        }) => p.id === item.quotePartId
                      );

                      // Show spinner if:
                      // 1. Conversion is in progress
                      // 2. Conversion completed but thumbnail not generated yet
                      // 3. Thumbnail exists but signed URL not loaded yet
                      const isProcessing =
                        part &&
                        (part.conversionStatus === "in_progress" ||
                          part.conversionStatus === "queued" ||
                          part.conversionStatus === "pending" ||
                          (part.conversionStatus === "completed" &&
                            !part.thumbnailUrl) ||
                          (part.thumbnailUrl && !part.signedThumbnailUrl) ||
                          (part.partFileUrl && !part.conversionStatus));

                      return (
                        <tr
                          key={item.id}
                          className={`${tableStyles.row} group`}
                        >
                          <td className={tableStyles.cell}>
                            <div className="flex items-center gap-3">
                              {part && (
                                <>
                                  {part.signedThumbnailUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => handleView3DModel(part as { id: string; partName: string; signedMeshUrl?: string; signedFileUrl?: string; signedThumbnailUrl?: string })}
                                      className="p-0 border-0 bg-transparent cursor-pointer"
                                      title="Click to view 3D model"
                                    >
                                      <img
                                        src={part.signedThumbnailUrl}
                                        alt={part.partName}
                                        className="w-12 h-12 object-cover rounded bg-gray-100 dark:bg-gray-800 flex-shrink-0 hover:opacity-80 transition-opacity"
                                      />
                                    </button>
                                  ) : (
                                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center flex-shrink-0 relative">
                                      {isProcessing ? (
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                                      ) : (
                                        <svg
                                          className="w-6 h-6 text-gray-400"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                          />
                                        </svg>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                              <span>
                                {part?.partName ||
                                  item.name ||
                                  item.description ||
                                  "Line Item"}
                              </span>
                            </div>
                          </td>
                          <td
                            className={`${tableStyles.cell} ${
                              !isQuoteLocked
                                ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                : ""
                            }`}
                            onClick={() =>
                              !isQuoteLocked &&
                              startEditingLineItem(
                                item.id,
                                "description",
                                item.description
                              )
                            }
                          >
                            {editingLineItem?.id === item.id &&
                            editingLineItem?.field === "description" ? (
                              <textarea
                                className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white resize-none"
                                value={editingLineItem.value}
                                onChange={(e) =>
                                  setEditingLineItem({
                                    ...editingLineItem,
                                    value: e.target.value,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && e.ctrlKey) {
                                    e.preventDefault();
                                    saveLineItemEdit();
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelEditingLineItem();
                                  }
                                }}
                                onBlur={saveLineItemEdit}
                                onClick={(e) => e.stopPropagation()}
                                rows={2}
                                placeholder="Add description... (Ctrl+Enter to save, Esc to cancel)"
                              />
                            ) : (
                              <span
                                className="block truncate max-w-xs"
                                title={item.description || ""}
                              >
                                {item.description || "—"}
                              </span>
                            )}
                          </td>
                          <td
                            className={`${tableStyles.cell} ${
                              !isQuoteLocked
                                ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                : ""
                            }`}
                            onClick={() =>
                              !isQuoteLocked &&
                              startEditingLineItem(item.id, "notes", item.notes)
                            }
                          >
                            {editingLineItem?.id === item.id &&
                            editingLineItem?.field === "notes" ? (
                              <textarea
                                className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white resize-none"
                                value={editingLineItem.value}
                                onChange={(e) =>
                                  setEditingLineItem({
                                    ...editingLineItem,
                                    value: e.target.value,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && e.ctrlKey) {
                                    e.preventDefault();
                                    saveLineItemEdit();
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelEditingLineItem();
                                  }
                                }}
                                onBlur={saveLineItemEdit}
                                onClick={(e) => e.stopPropagation()}
                                rows={2}
                                placeholder="Add notes... (Ctrl+Enter to save, Esc to cancel)"
                              />
                            ) : (
                              <span
                                className="block truncate max-w-xs"
                                title={item.notes || ""}
                              >
                                {item.notes || "—"}
                              </span>
                            )}
                          </td>
                          <td
                            className={`${tableStyles.cell} ${
                              !isQuoteLocked
                                ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                : ""
                            }`}
                            onClick={() =>
                              !isQuoteLocked &&
                              startEditingLineItem(
                                item.id,
                                "quantity",
                                item.quantity
                              )
                            }
                          >
                            {editingLineItem?.id === item.id &&
                            editingLineItem?.field === "quantity" ? (
                              <input
                                ref={editInputRef}
                                type="number"
                                className="w-20 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                                value={editingLineItem.value}
                                onChange={(e) =>
                                  setEditingLineItem({
                                    ...editingLineItem,
                                    value: e.target.value,
                                  })
                                }
                                onKeyDown={handleLineItemKeyDown}
                                onBlur={cancelEditingLineItem}
                                onClick={(e) => e.stopPropagation()}
                                min="1"
                              />
                            ) : (
                              item.quantity
                            )}
                          </td>
                          <td
                            className={`${tableStyles.cell} ${
                              !isQuoteLocked
                                ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                : ""
                            }`}
                            onClick={() =>
                              !isQuoteLocked &&
                              startEditingLineItem(
                                item.id,
                                "unitPrice",
                                item.unitPrice
                              )
                            }
                          >
                            {editingLineItem?.id === item.id &&
                            editingLineItem?.field === "unitPrice" ? (
                              <div className="flex items-center">
                                <span className="mr-1">$</span>
                                <input
                                  ref={editInputRef}
                                  type="text"
                                  className="w-24 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                                  value={editingLineItem.value}
                                  onChange={(e) =>
                                    setEditingLineItem({
                                      ...editingLineItem,
                                      value: e.target.value,
                                    })
                                  }
                                  onKeyDown={handleLineItemKeyDown}
                                  onBlur={cancelEditingLineItem}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            ) : (
                              `$${item.unitPrice}`
                            )}
                          </td>
                          <td
                            className={`${tableStyles.cell} ${
                              !isQuoteLocked
                                ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                : ""
                            }`}
                            onClick={() =>
                              !isQuoteLocked &&
                              startEditingLineItem(
                                item.id,
                                "totalPrice",
                                item.totalPrice
                              )
                            }
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center">
                                {editingLineItem?.id === item.id &&
                                editingLineItem?.field === "totalPrice" ? (
                                  <>
                                    <span className="mr-1">$</span>
                                    <input
                                      ref={editInputRef}
                                      type="text"
                                      className="w-24 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                                      value={editingLineItem.value}
                                      onChange={(e) =>
                                        setEditingLineItem({
                                          ...editingLineItem,
                                          value: e.target.value,
                                        })
                                      }
                                      onKeyDown={handleLineItemKeyDown}
                                      onBlur={cancelEditingLineItem}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </>
                                ) : (
                                  `$${item.totalPrice}`
                                )}
                              </div>
                              {!isQuoteLocked && (
                                <div className="flex items-center gap-2">
                                  {part && canAccessPriceCalculator && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenCalculatorForPart(part.id);
                                        // Remove focus after click
                                        (e.target as HTMLButtonElement).blur();
                                      }}
                                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all outline-none focus:outline-none"
                                      title="Calculate price for this part"
                                    >
                                      <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteLineItem(item.id, part?.id);
                                      // Remove focus after click
                                      (e.target as HTMLButtonElement).blur();
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all outline-none focus:outline-none"
                                    title="Delete line item"
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300"
                      >
                        Total: ${optimisticTotal}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No line items added yet.
                </p>
              )}
            </div>
          </div>

          {/* Attachments Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Attachments
              </h3>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                {!isQuoteLocked && (
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    size="sm"
                  >
                    Upload File
                  </Button>
                )}
              </div>
            </div>
            <div className="p-6">
              {attachments && attachments.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {attachments.map(
                    (attachment: {
                      id: string;
                      fileName: string;
                      fileSize?: number;
                      contentType?: string;
                      downloadUrl?: string;
                    }) => (
                      <div
                        key={attachment.id}
                        className={`
                      relative p-4 rounded-lg border-2 border-gray-200 dark:border-gray-600 transition-all
                      ${
                        isViewableFile(attachment.fileName)
                          ? "bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer hover:scale-[1.02] hover:shadow-md focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none"
                          : "bg-gray-50 dark:bg-gray-700"
                      }
                    `}
                        onClick={
                          isViewableFile(attachment.fileName) &&
                          attachment.downloadUrl
                            ? () =>
                                handleViewFile(
                                  attachment as {
                                    downloadUrl: string;
                                    fileName: string;
                                    id: string;
                                    contentType?: string;
                                    fileSize?: number;
                                  }
                                )
                            : undefined
                        }
                        onKeyDown={
                          isViewableFile(attachment.fileName) &&
                          attachment.downloadUrl
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleViewFile(
                                    attachment as {
                                      downloadUrl: string;
                                      fileName: string;
                                      id: string;
                                      contentType?: string;
                                      fileSize?: number;
                                    }
                                  );
                                }
                              }
                            : undefined
                        }
                        role={
                          isViewableFile(attachment.fileName)
                            ? "button"
                            : undefined
                        }
                        tabIndex={
                          isViewableFile(attachment.fileName) ? 0 : undefined
                        }
                      >
                        <div className="flex-1 pointer-events-none">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {attachment.fileName}
                            </p>
                            {isViewableFile(attachment.fileName) && (
                              <span className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                                {getFileType(
                                  attachment.fileName
                                ).type.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatFileSize(attachment.fileSize || 0)}
                          </p>
                        </div>
                        <div
                          className="absolute top-4 right-4 flex gap-2 pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          role="presentation"
                        >
                          {!isViewableFile(attachment.fileName) && (
                            <Button
                              onClick={() =>
                                window.open(attachment.downloadUrl, "_blank")
                              }
                              variant="secondary"
                              size="sm"
                            >
                              Download
                            </Button>
                          )}
                          {!isQuoteLocked && (
                            <Button
                              onClick={() =>
                                handleDeleteAttachment(attachment.id)
                              }
                              variant="danger"
                              size="sm"
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No attachments uploaded yet.
                </p>
              )}
            </div>
          </div>

          {/* Notes and Event Log Section - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Notes */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Quote Notes
                </h3>
                {!isAddingNote && !isQuoteLocked && (
                  <Button size="sm" onClick={() => setIsAddingNote(true)}>
                    Add Note
                  </Button>
                )}
              </div>
              <div className="p-6">
                <Notes
                  entityType="quote"
                  entityId={quote.id.toString()}
                  initialNotes={notes}
                  currentUserId={user.id}
                  currentUserName={userDetails?.name || user.email}
                  showHeader={false}
                  onAddNoteClick={() => setIsAddingNote(false)}
                  isAddingNote={isAddingNote}
                  externalControl={true}
                  readOnly={isQuoteLocked}
                />
              </div>
            </div>

            {/* Event Log */}
            <EventTimeline
              entityType="quote"
              entityId={quote.id.toString()}
              entityName={quote.quoteNumber}
              initialEvents={events}
            />
          </div>
        </div>
      </div>

      {/* File Viewer Modal */}
      {selectedFile && (
        <FileViewerModal
          isOpen={isFileViewerOpen}
          onClose={() => {
            setIsFileViewerOpen(false);
            setSelectedFile(null);
          }}
          fileUrl={selectedFile.url}
          fileName={selectedFile.fileName}
          contentType={selectedFile.contentType}
          fileSize={selectedFile.fileSize}
        />
      )}

      {/* Quote Parts Modal */}
      {quote.parts && quote.parts.length > 0 && (
        <QuotePartsModal
          isOpen={isPartsModalOpen}
          onClose={() => setIsPartsModalOpen(false)}
          parts={quote.parts}
          quoteId={quote.id}
        />
      )}

      {/* 3D Viewer Modal */}
      {selectedPart3D && (
        <Part3DViewerModal
          isOpen={part3DModalOpen}
          onClose={() => {
            setPart3DModalOpen(false);
            setSelectedPart3D(null);
          }}
          partName={selectedPart3D.partName}
          modelUrl={selectedPart3D.modelUrl}
          solidModelUrl={selectedPart3D.solidModelUrl}
          partId={selectedPart3D.partId}
          onThumbnailUpdate={() => {
            revalidator.revalidate();
          }}
          autoGenerateThumbnail={true}
          existingThumbnailUrl={selectedPart3D.thumbnailUrl}
        />
      )}

      {/* Hidden Thumbnail Generators for parts without thumbnails */}
      {quote.parts?.map(
        (part: {
          id: string;
          signedMeshUrl?: string;
          thumbnailUrl?: string | null;
          conversionStatus: string | null;
        }) => {
          if (
            part.signedMeshUrl &&
            part.conversionStatus === "completed" &&
            !part.thumbnailUrl
          ) {
            return (
              <HiddenThumbnailGenerator
                key={part.id}
                modelUrl={part.signedMeshUrl}
                partId={part.id}
                entityType="quote-part"
                onComplete={() => {
                  revalidator.revalidate();
                }}
              />
            );
          }
          return null;
        }
      )}

      {/* Add Line Item Modal */}
      <AddQuoteLineItemModal
        isOpen={isAddLineItemModalOpen}
        onClose={() => setIsAddLineItemModalOpen(false)}
        onSubmit={handleAddLineItemSubmit}
      />

      {canAccessPriceCalculator && (
        <QuotePriceCalculatorModal
          isOpen={isCalculatorOpen && canAccessPriceCalculator}
          onClose={() => setIsCalculatorOpen(false)}
          quoteParts={quote.parts || []}
          quoteLineItems={quote.lineItems || []}
          quoteId={quote.id}
          onSave={handleSaveCalculation}
          currentPartIndex={currentCalculatorPartIndex}
          onPartChange={setCurrentCalculatorPartIndex}
          existingCalculations={priceCalculations || []}
        />
      )}

      <GenerateQuotePdfModal
        isOpen={isGeneratePdfModalOpen}
        onClose={() => setIsGeneratePdfModalOpen(false)}
        quote={quote}
        autoDownload={pdfAutoDownload}
      />

      <GenerateInvoicePdfModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        entity={quote}
        lineItems={quote.lineItems || []}
        parts={quote.parts || []}
        autoDownload={pdfAutoDownload}
      />

      <Modal
        isOpen={isRejectModalOpen}
        onClose={handleRejectModalClose}
        title="Reject Quote"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Are you sure you want to reject this quote?
            {rejectionReasonRequired && (
              <span className="font-medium"> A rejection reason is required.</span>
            )}
          </p>
          <div>
            <label
              htmlFor="rejectionReason"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Rejection Reason {rejectionReasonRequired && <span className="text-red-500">*</span>}
              {!rejectionReasonRequired && <span className="text-gray-500 font-normal">(Optional)</span>}
            </label>
            <textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              rows={4}
              placeholder="Enter the reason for rejecting this quote..."
              required={rejectionReasonRequired}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              onClick={handleRejectModalClose}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectQuoteConfirm}
              variant="danger"
            >
              Reject Quote
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
            {error.status} {error.statusText}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error.data || "An error occurred while loading the quote."}
          </p>
          <div className="flex gap-4">
            <a
              href="/quotes"
              className="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Back to Quotes
            </a>
            <button
              onClick={() => window.location.reload()}
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
          Unexpected Error
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {error instanceof Error ? error.message : "An unexpected error occurred while loading the quote."}
        </p>
        <div className="flex gap-4">
          <a
            href="/quotes"
            className="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Back to Quotes
          </a>
          <button
            onClick={() => window.location.reload()}
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
