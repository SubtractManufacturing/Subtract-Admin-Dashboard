import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  redirect,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
  Link,
} from "@remix-run/react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  getQuote,
  updateQuote,
  archiveQuote,
  restoreQuote,
  convertQuoteToOrder,
  duplicateQuote,
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
import { tryPartAssetAdminAction } from "~/lib/part-asset-admin.server";
import {
  canUserAccessPriceCalculator,
  canUserAccessToolpath,
  canUserUploadCadRevision,
  isFeatureEnabled,
  isOutboundEmailEnabled,
  isStripePaymentLinksEnabled,
  shouldHideLineItemThumbnails,
  FEATURE_FLAGS,
} from "~/lib/featureFlags";
import { deactivateQuotePaymentLink } from "~/lib/stripe.server";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import {
  handleEmailPreviewAction,
  handleEmailQueueAction,
} from "~/lib/email/outbound-email-route-actions.server";
import {
  uploadFile,
  generateFileKey,
  deleteFile,
  getDownloadUrl,
  extractS3Key,
} from "~/lib/s3.server";
import {
  getBananaModelUrls,
  getPlaceholderPartUrls,
  getLineItemArchiveRetentionDays,
} from "~/lib/developerSettings";
import {
  archiveQuoteLineItem,
  listArchivedQuoteLineItems,
  restoreQuoteLineItem,
} from "~/lib/line-item-archive.server";
import {
  quotePartUsesPlaceholderCad,
  resolveQuotePartPreviewAssets,
} from "~/lib/quote-part-assets.server";
import { generateDocumentPdf } from "~/lib/pdf-service.server";
import { generatePdfThumbnail, isPdfFile } from "~/lib/pdf-thumbnail.server";
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
  quoteLineItems,
  quoteParts,
  type AttachmentDocumentKind,
} from "~/lib/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import {
  parseLineTotalInput,
  parseUnitPriceInput,
  quotePositiveSubtotalExcluding,
} from "~/lib/lineItemPricing";
import { getToolpathReportHrefForUi, isAllowedToolpathReportUrl } from "~/lib/toolpath";
import {
  isToolpathEnabled,
  TOOLPATH_PART_CREATION_INTERVAL_MS,
} from "~/lib/toolpath.server";
import { sendToolpathUploadJob } from "~/lib/queue/producer.server";
import {
  formatToolpathQueueError,
  logToolpathUploadAlert,
} from "~/lib/toolpath-upload.server";
import {
  isToolpathUploadInFlight,
  TOOLPATH_UPLOAD_STATUS,
} from "~/lib/toolpath-upload";

import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import { AttachmentsSection } from "~/components/shared/AttachmentsSection";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { usePartAssetAdminAccess } from "~/components/admin/PartAssetAdminFlyout";
import Modal from "~/components/shared/Modal";
import { Notes } from "~/components/shared/Notes";
import { EventTimeline } from "~/components/EventTimeline";
import { AddLineItemModal } from "~/components/shared/AddLineItemModal";
import { LineItemsSection } from "~/components/shared/LineItemsSection";
import { IconButton } from "~/components/shared/IconButton";
import { FilePlusCorner } from "lucide-react";
import QuoteActionsDropdown from "~/components/quotes/QuoteActionsDropdown";
import ReceivePoModal from "~/components/quotes/ReceivePoModal";
import type { ReceivePoActionData } from "~/components/quotes/ReceivePoModal";
import QuotePriceCalculatorModal from "~/components/quotes/QuotePriceCalculatorModal";
import QuoteDeliveryDateCard from "~/components/quotes/QuoteDeliveryDateCard";
import {
  addBusinessDays,
  formatLeadTimeBusinessDays,
  leadTimeOptionToBusinessDays,
  startOfTodayInAppTz,
} from "~/lib/business-days";
import GenerateQuotePdfModal from "~/components/quotes/GenerateQuotePdfModal";
import GenerateInvoicePdfModal from "~/components/orders/GenerateInvoicePdfModal";
import { HiddenThumbnailGenerator } from "~/components/HiddenThumbnailGenerator";
import { Part3DViewerModal } from "~/components/shared/Part3DViewerModal";
import SendQuoteEmailModal from "~/components/quotes/SendQuoteEmailModal";
import ToolpathUploadModal, {
  type ToolpathUploadResult,
  type ToolpathUploadSelection,
} from "~/components/quotes/ToolpathUploadModal";
import { ToolpathIcon } from "~/components/icons/ToolpathIcon";
import { useDownload } from "~/hooks/useDownload";
import {
  createPriceCalculation,
  getLatestCalculationsForQuote,
} from "~/lib/quotePriceCalculations";
import {
  normalizeQuoteLineItems,
  type NormalizedDrawing,
  type NormalizedLineItem,
  type NormalizedPart,
} from "~/components/shared/line-items/types";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const quoteId = params.quoteId;
  if (!quoteId) {
    throw new Response("Quote ID is required", { status: 400 });
  }

  const quote = await getQuote(parseInt(quoteId));
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }

  // Fetch customer and vendor details, plus selectable lists for editing
  const [customer, vendor, customers, vendors] = await Promise.all([
    quote.customerId ? getCustomer(quote.customerId) : null,
    quote.vendorId ? getVendor(quote.vendorId) : null,
    getCustomers(),
    getVendors(),
  ]);

  const globalPlaceholder = await getPlaceholderPartUrls();

  // Generate signed URLs for quote parts with meshes, solid files, thumbnails, and drawings
  const partsWithSignedUrls = await Promise.all(
    (quote.parts || []).map(async (part) => {
      let signedMeshUrl = undefined;
      let signedFileUrl = undefined;
      let signedThumbnailUrl = undefined;

      const preview = resolveQuotePartPreviewAssets(
        {
          specifications: part.specifications,
          partFileUrl: part.partFileUrl,
          partMeshUrl: part.partMeshUrl,
          conversionStatus: part.conversionStatus,
        },
        globalPlaceholder,
      );

      // Preview mesh (includes live Settings placeholder when usesPlaceholderCad)
      if (
        preview.effectiveConversionStatus === "completed" &&
        preview.meshKey
      ) {
        const { getQuotePartMeshUrl } =
          await import("~/lib/quote-part-mesh-converter.server");
        const result = await getQuotePartMeshUrl(part.id, globalPlaceholder);
        if ("url" in result) {
          signedMeshUrl = result.url;
        }
      }

      const usesPh = quotePartUsesPlaceholderCad(part.specifications);
      // Preview solid CAD URL (not included in bulk zip when placeholder-only)
      if (
        usesPh &&
        preview.cadKey &&
        preview.effectiveConversionStatus === "completed"
      ) {
        try {
          signedFileUrl = await getDownloadUrl(
            extractS3Key(preview.cadKey),
            3600,
          );
        } catch (error) {
          console.error(
            "Error getting signed file URL for part",
            part.id,
            ":",
            error,
          );
        }
      } else if (part.partFileUrl) {
        try {
          signedFileUrl = await getDownloadUrl(
            extractS3Key(part.partFileUrl),
            3600,
          );
        } catch (error) {
          console.error(
            "Error getting signed file URL for part",
            part.id,
            ":",
            error,
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
            error,
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
          eq(quotePartDrawings.attachmentId, attachments.id),
        )
        .where(eq(quotePartDrawings.quotePartId, part.id));

      const drawings = await Promise.all(
        drawingRecords
          .filter((record) => record.attachment !== null)
          .map(async (record) => {
            const attachment = record.attachment!;
            try {
              const signedUrl = await getDownloadUrl(attachment.s3Key, 3600);

              let thumbnailSignedUrl: string | null = null;
              if (attachment.thumbnailS3Key) {
                try {
                  thumbnailSignedUrl = await getDownloadUrl(
                    attachment.thumbnailS3Key,
                    3600,
                  );
                } catch {
                  // Thumbnail URL generation failed, will fall back to icon
                }
              }

              return {
                id: attachment.id,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
                fileSize: attachment.fileSize,
                signedUrl,
                thumbnailSignedUrl,
              };
            } catch (error) {
              console.error(
                "Error generating signed URL for quote drawing:",
                error,
              );
              return null;
            }
          }),
      );

      const spec = part.specifications as Record<string, unknown> | null;
      return {
        ...part,
        signedMeshUrl,
        signedFileUrl,
        signedThumbnailUrl,
        drawings: drawings.filter((d) => d !== null),
        usesPlaceholderCad: spec?.usesPlaceholderCad === true,
      };
    }),
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
        attachment !== null,
    );

  // Attachments are served via the unified download route — no presigned URLs needed
  const attachmentsWithUrls = attachmentList;

  // Get feature flags and events
  const [
    canAccessPriceCalculator,
    pdfAutoDownload,
    rejectionReasonRequired,
    events,
    canRevise,
    bananaEnabled,
    stripeEnabled,
    outboundEmailEnabled,
    hideLineItemThumbnails,
    canAccessToolpath,
  ] = await Promise.all([
    canUserAccessPriceCalculator(userDetails?.role),
    isFeatureEnabled(FEATURE_FLAGS.PDF_AUTO_DOWNLOAD),
    isFeatureEnabled(FEATURE_FLAGS.QUOTE_REJECTION_REASON_REQUIRED),
    getEventsByEntity("quote", quote.id.toString(), 10),
    canUserUploadCadRevision(userDetails?.role),
    isFeatureEnabled(FEATURE_FLAGS.BANANA_FOR_SCALE),
    isStripePaymentLinksEnabled(),
    isOutboundEmailEnabled(),
    shouldHideLineItemThumbnails(),
    canUserAccessToolpath(),
  ]);

  let quoteSendEmailReady = false;
  let quoteSendEmailDefaultSubject: string | null = null;
  let quoteSendRequiredAttachmentDocumentKinds: AttachmentDocumentKind[] = [];
  type QuoteSendEditableSlot = {
    id: string;
    type: "plainText" | "markdown";
    adminLabel: string;
    templateValue: string;
  };
  let quoteSendEditableSlots: QuoteSendEditableSlot[] = [];
  if (outboundEmailEnabled) {
    const { resolveEmailTemplateForContext, getEmailMergeFieldsMap } =
      await import("~/lib/email/templates.server");
    const { interpolateTemplateString } =
      await import("~/emails/render.server");
    const { EMAIL_CONTEXT } =
      await import("~/lib/email/email-context-registry");
    const { getLayoutDefinition, parseBodyCopyForLayout } =
      await import("~/emails/registry");
    const { buildActorMergeMap } =
      await import("~/lib/email/resolve/actor-merge.server");
    const actorMerge = buildActorMergeMap({
      email: userDetails?.email?.trim() || user?.email?.trim() || "",
      name: userDetails?.name,
    });
    const [resolved, mergeFields] = await Promise.all([
      resolveEmailTemplateForContext(EMAIL_CONTEXT.QUOTE_SEND),
      getEmailMergeFieldsMap(),
    ]);
    if (resolved) {
      quoteSendEmailReady = true;
      quoteSendRequiredAttachmentDocumentKinds =
        resolved.template.requiredAttachmentDocumentKinds ?? [];
      quoteSendEmailDefaultSubject = interpolateTemplateString(
        resolved.template.subjectTemplate,
        {
          ...mergeFields,
          ...actorMerge,
          quoteNumber: quote.quoteNumber,
          customerName: customer?.displayName ?? "Customer",
          total: quote.total ?? "0.00",
        },
      );
      const definition = getLayoutDefinition(resolved.layoutSlug);
      const bodyParseResult = parseBodyCopyForLayout(
        resolved.layoutSlug,
        resolved.template.bodyCopy ?? {},
      );
      if (bodyParseResult.ok) {
        quoteSendEditableSlots = definition.slots
          .filter(
            (s): s is Extract<typeof s, { type: "plainText" | "markdown" }> =>
              !!s.allowPerSendEdit && s.type !== "button",
          )
          .map((s) => ({
            id: s.id,
            type: s.type as "plainText" | "markdown",
            adminLabel: s.adminLabel,
            templateValue: String(
              (bodyParseResult.data as Record<string, unknown>)[s.id] ?? "",
            ),
          }));
      }
    }
  }

  // Get banana model URL if feature is enabled
  let bananaModelUrl: string | null = null;
  if (bananaEnabled) {
    const bananaUrls = await getBananaModelUrls();
    if (bananaUrls.meshUrl && bananaUrls.conversionStatus === "completed") {
      bananaModelUrl = await getDownloadUrl(bananaUrls.meshUrl);
    }
  }

  // Fetch converted order if exists
  const convertedOrder = quote.convertedToOrderId
    ? await getOrder(quote.convertedToOrderId)
    : null;

  // Fetch existing price calculations for the quote
  const priceCalculations = await getLatestCalculationsForQuote(quote.id);

  const [archivedLineItems, archiveRetentionDays] = await Promise.all([
    listArchivedQuoteLineItems(quote.id),
    getLineItemArchiveRetentionDays(),
  ]);

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
      canAccessPriceCalculator,
      pdfAutoDownload,
      rejectionReasonRequired,
      events,
      convertedOrder,
      canRevise,
      bananaEnabled,
      bananaModelUrl,
      stripeEnabled,
      outboundEmailEnabled,
      hideLineItemThumbnails,
      canAccessToolpath,
      quoteSendEmailReady,
      quoteSendEmailDefaultSubject,
      quoteSendEditableSlots,
      quoteSendRequiredAttachmentDocumentKinds,
      archivedLineItems: archivedLineItems.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        archivedAt: item.archivedAt.toISOString(),
        hardDeleteAt: item.hardDeleteAt.toISOString(),
        quotePartId: item.quotePartId,
      })),
      archiveRetentionDays,
    }),
    headers,
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

    formData = await unstable_parseMultipartFormData(request, uploadHandler);
    const intent = formData.get("intent");

    // Handle add line item with file upload (or promote standalone line item to part-backed)
    if (intent === "addLineItem" || intent === "promoteLineItemToQuotePart") {
      const isPromote = intent === "promoteLineItemToQuotePart";
      // Auto-convert RFQ to Draft when editing starts
      await autoConvertRFQToDraft();

      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const notes = formData.get("notes") as string;
      const quantity = formData.get("quantity") as string;
      const unitPrice = formData.get("unitPrice") as string;
      const file = formData.get("file") as File | null;
      const material = (formData.get("material") as string) || null;
      const tolerance = (formData.get("tolerance") as string) || null;
      const finish = (formData.get("finish") as string) || null;

      if (!name || !quantity || !unitPrice) {
        return json({ error: "Missing required fields" }, { status: 400 });
      }

      let promoteLineItemId: number | null = null;
      if (isPromote) {
        const rawLi = formData.get("lineItemId");
        if (!rawLi) {
          return json({ error: "Line item ID is required" }, { status: 400 });
        }
        promoteLineItemId = parseInt(String(rawLi), 10);
        if (Number.isNaN(promoteLineItemId)) {
          return json({ error: "Invalid line item ID" }, { status: 400 });
        }
        const [existingLineItem] = await db
          .select()
          .from(quoteLineItems)
          .where(eq(quoteLineItems.id, promoteLineItemId))
          .limit(1);
        if (!existingLineItem || existingLineItem.quoteId !== quote.id) {
          return json({ error: "Line item not found" }, { status: 404 });
        }
        if (existingLineItem.quotePartId) {
          return json(
            { error: "This line item already has an attached part" },
            { status: 400 },
          );
        }
        if (!file || file.size === 0) {
          return json(
            {
              error:
                "Upload a CAD file or drawing to attach a part to this line item",
            },
            { status: 400 },
          );
        }
      }

      try {
        let quotePartId: string | null = null;

        // If a file was uploaded, create a quote part
        if (file && file.size > 0) {
          const { quoteParts } = await import("~/lib/db/schema");
          const { triggerQuotePartMeshConversion } =
            await import("~/lib/quote-part-mesh-converter.server");
          const { isCadSourceFile, isDrawingSourceFile } =
            await import("~/lib/part-source-files");
          const { ensureDrawingOnlyQuotePartAssets } =
            await import("~/lib/quote-part-assets.server");
          const crypto = await import("crypto");

          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          const partNumber = `QP-${Date.now()}-${crypto
            .randomBytes(4)
            .toString("hex")}`;

          const primaryIsCad = isCadSourceFile(file.name);
          const primaryIsDrawing = isDrawingSourceFile(file.name);

          if (!primaryIsCad && !primaryIsDrawing) {
            return json(
              { error: "Unsupported file type for line item upload" },
              { status: 400 },
            );
          }

          if (primaryIsDrawing && !primaryIsCad) {
            const [newQuotePart] = await db
              .insert(quoteParts)
              .values({
                quoteId: quote.id,
                partNumber,
                partName: name,
                description: description || null,
                material,
                tolerance,
                finish,
                partFileUrl: null,
                conversionStatus: "pending",
                specifications: { primarySource: "drawing_only" },
              })
              .returning();

            quotePartId = newQuotePart.id;

            const sanitizedDrawingName = file.name
              .replace(/\s+/g, "-")
              .replace(/[^a-zA-Z0-9._-]/g, "");
            const timestamp = Date.now();
            const drawingKey = `quote-parts/${newQuotePart.id}/drawings/${timestamp}-0-${sanitizedDrawingName}`;
            const { contentTypeForDrawingFileName } =
              await import("~/lib/part-source-files");
            const drawingContentType = contentTypeForDrawingFileName(file.name);
            const drawingUploadResult = await uploadFile({
              key: drawingKey,
              buffer,
              contentType: drawingContentType,
              fileName: sanitizedDrawingName,
            });

            let thumbnailS3Key: string | null = null;
            if (isPdfFile(file.type, file.name)) {
              try {
                const thumbnail = await generatePdfThumbnail(buffer, 200, 200);
                const thumbnailKey = `quote-parts/${newQuotePart.id}/drawings/${timestamp}-0-${sanitizedDrawingName}.thumb.png`;
                await uploadFile({
                  key: thumbnailKey,
                  buffer: thumbnail.buffer,
                  contentType: "image/png",
                  fileName: `${sanitizedDrawingName}.thumb.png`,
                });
                thumbnailS3Key = thumbnailKey;
              } catch (thumbnailError) {
                console.error(
                  "Failed to generate PDF thumbnail:",
                  thumbnailError,
                );
              }
            }

            const { attachments, quotePartDrawings } =
              await import("~/lib/db/schema");
            const [attachment] = await db
              .insert(attachments)
              .values({
                s3Bucket: process.env.S3_BUCKET || "default-bucket",
                s3Key: drawingUploadResult.key,
                fileName: file.name,
                contentType: drawingContentType,
                fileSize: file.size,
                thumbnailS3Key,
                source: "user_upload",
              })
              .returning();

            await db.insert(quotePartDrawings).values({
              quotePartId: newQuotePart.id,
              attachmentId: attachment.id,
              version: 1,
            });

            const drawingCount =
              parseInt(formData.get("drawingCount") as string) || 0;
            if (drawingCount > 0) {
              for (let i = 0; i < drawingCount; i++) {
                const drawing = formData.get(`drawing_${i}`) as File | null;
                if (drawing && drawing.size > 0) {
                  const drawingArrayBuffer = await drawing.arrayBuffer();
                  const drawingBuffer = Buffer.from(drawingArrayBuffer);
                  const sanitizedName = drawing.name
                    .replace(/\s+/g, "-")
                    .replace(/[^a-zA-Z0-9._-]/g, "");
                  const ts = Date.now();
                  const dKey = `quote-parts/${newQuotePart.id}/drawings/${ts}-${i + 1}-${sanitizedName}`;
                  const ct = contentTypeForDrawingFileName(drawing.name);
                  const dUpload = await uploadFile({
                    key: dKey,
                    buffer: drawingBuffer,
                    contentType: ct,
                    fileName: sanitizedName,
                  });
                  let dThumb: string | null = null;
                  if (isPdfFile(drawing.type, drawing.name)) {
                    try {
                      const th = await generatePdfThumbnail(
                        drawingBuffer,
                        200,
                        200,
                      );
                      const thKey = `quote-parts/${newQuotePart.id}/drawings/${ts}-${i + 1}-${sanitizedName}.thumb.png`;
                      await uploadFile({
                        key: thKey,
                        buffer: th.buffer,
                        contentType: "image/png",
                        fileName: `${sanitizedName}.thumb.png`,
                      });
                      dThumb = thKey;
                    } catch (e) {
                      console.error("PDF thumbnail failed:", e);
                    }
                  }
                  const [att2] = await db
                    .insert(attachments)
                    .values({
                      s3Bucket: process.env.S3_BUCKET || "default-bucket",
                      s3Key: dUpload.key,
                      fileName: drawing.name,
                      contentType: ct,
                      fileSize: drawing.size,
                      thumbnailS3Key: dThumb,
                      source: "user_upload",
                    })
                    .returning();
                  await db.insert(quotePartDrawings).values({
                    quotePartId: newQuotePart.id,
                    attachmentId: att2.id,
                    version: 1,
                  });
                }
              }
            }

            await ensureDrawingOnlyQuotePartAssets(newQuotePart.id, {
              primaryDrawingBuffer: buffer,
              primaryDrawingFileName: file.name,
            });
          } else {
            const sanitizedFileName = file.name
              .replace(/\s+/g, "-")
              .replace(/[^a-zA-Z0-9._-]/g, "");

            const fileKey = `quote-parts/${crypto.randomUUID()}/source/${sanitizedFileName}`;

            const uploadResult = await uploadFile({
              key: fileKey,
              buffer,
              contentType: file.type || "application/octet-stream",
              fileName: sanitizedFileName,
            });

            const [newQuotePart] = await db
              .insert(quoteParts)
              .values({
                quoteId: quote.id,
                partNumber,
                partName: name,
                description: description || null,
                material,
                tolerance,
                finish,
                partFileUrl: uploadResult.key,
                conversionStatus: "pending",
              })
              .returning();

            quotePartId = newQuotePart.id;

            triggerQuotePartMeshConversion(
              newQuotePart.id,
              uploadResult.key,
            ).catch(async (error) => {
              console.error(
                `Failed to trigger mesh conversion for quote part ${newQuotePart.id}:`,
                error,
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
              const { attachments, quotePartDrawings } =
                await import("~/lib/db/schema");

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
                  const timestamp = Date.now();
                  const drawingKey = `quote-parts/${newQuotePart.id}/drawings/${timestamp}-${i}-${sanitizedDrawingName}`;
                  const drawingUploadResult = await uploadFile({
                    key: drawingKey,
                    buffer: drawingBuffer,
                    contentType: drawing.type || "application/pdf",
                    fileName: sanitizedDrawingName,
                  });

                  // Generate thumbnail for PDFs
                  let thumbnailS3Key: string | null = null;
                  if (isPdfFile(drawing.type, drawing.name)) {
                    try {
                      const thumbnail = await generatePdfThumbnail(
                        drawingBuffer,
                        200,
                        200,
                      );
                      const thumbnailKey = `quote-parts/${newQuotePart.id}/drawings/${timestamp}-${i}-${sanitizedDrawingName}.thumb.png`;
                      await uploadFile({
                        key: thumbnailKey,
                        buffer: thumbnail.buffer,
                        contentType: "image/png",
                        fileName: `${sanitizedDrawingName}.thumb.png`,
                      });
                      thumbnailS3Key = thumbnailKey;
                    } catch (thumbnailError) {
                      console.error(
                        "Failed to generate PDF thumbnail:",
                        thumbnailError,
                      );
                    }
                  }

                  // Create attachment record
                  const [attachment] = await db
                    .insert(attachments)
                    .values({
                      s3Bucket: process.env.S3_BUCKET || "default-bucket",
                      s3Key: drawingUploadResult.key,
                      fileName: drawing.name,
                      contentType: drawing.type || "application/pdf",
                      fileSize: drawing.size,
                      thumbnailS3Key,
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
        }

        // Create or update quote line item
        const { createQuoteLineItem, calculateQuoteTotals } =
          await import("~/lib/quotes");

        if (isPromote && promoteLineItemId != null) {
          const qty = parseInt(quantity, 10);
          if (Number.isNaN(qty) || qty <= 0) {
            return json({ error: "Invalid quantity" }, { status: 400 });
          }
          const unitParsed = parseUnitPriceInput(unitPrice, {
            quantity: qty,
            positiveSubtotal: 0,
            isPartLinked: true,
          });
          if (!unitParsed.ok) {
            return json({ error: unitParsed.error }, { status: 400 });
          }
          const unit = unitParsed.unitPrice;
          const totalPriceStr = (qty * unit).toFixed(2);
          await db
            .update(quoteLineItems)
            .set({
              quotePartId,
              name: name.trim() || null,
              description: description?.trim() || null,
              notes: notes?.trim() || null,
              quantity: qty,
              unitPrice: unit.toFixed(2),
              totalPrice: totalPriceStr,
              updatedAt: new Date(),
            })
            .where(eq(quoteLineItems.id, promoteLineItemId));

          await createEvent({
            entityType: "quote",
            entityId: quote.id.toString(),
            eventType: "quote_line_item_updated",
            eventCategory: "financial",
            title: "Line Item Linked to Part",
            description: `Attached a manufacturing part to line item ${name.trim() || promoteLineItemId}`,
            metadata: {
              lineItemId: promoteLineItemId,
              quotePartId,
            },
            userId: eventContext?.userId,
            userEmail: eventContext?.userEmail,
          });
        } else {
          const qty = parseInt(quantity, 10);
          if (Number.isNaN(qty) || qty <= 0) {
            return json({ error: "Invalid quantity" }, { status: 400 });
          }
          const existingLines = await db
            .select()
            .from(quoteLineItems)
            .where(eq(quoteLineItems.quoteId, quote.id));
          const positiveSub = quotePositiveSubtotalExcluding(existingLines);
          const unitParsed = parseUnitPriceInput(unitPrice, {
            quantity: qty,
            positiveSubtotal: positiveSub,
            isPartLinked: !!quotePartId,
          });
          if (!unitParsed.ok) {
            return json({ error: unitParsed.error }, { status: 400 });
          }
          await createQuoteLineItem(
            quote.id,
            {
              quotePartId: quotePartId || undefined,
              name: name || undefined,
              quantity: qty,
              unitPrice: unitParsed.unitPrice,
              description: description || undefined,
              notes: notes || undefined,
            },
            eventContext,
          );
        }

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
          { status: 400 },
        );
      }

      try {
        const { attachments, quotePartDrawings } =
          await import("~/lib/db/schema");

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
            const timestamp = Date.now();
            const drawingKey = `quote-parts/${quotePartId}/drawings/${timestamp}-${i}-${sanitizedDrawingName}`;
            const drawingUploadResult = await uploadFile({
              key: drawingKey,
              buffer: drawingBuffer,
              contentType: drawing.type || "application/pdf",
              fileName: sanitizedDrawingName,
            });

            // Generate thumbnail for PDFs
            let thumbnailS3Key: string | null = null;
            if (isPdfFile(drawing.type, drawing.name)) {
              try {
                const thumbnail = await generatePdfThumbnail(
                  drawingBuffer,
                  200,
                  200,
                );
                const thumbnailKey = `quote-parts/${quotePartId}/drawings/${timestamp}-${i}-${sanitizedDrawingName}.thumb.png`;
                await uploadFile({
                  key: thumbnailKey,
                  buffer: thumbnail.buffer,
                  contentType: "image/png",
                  fileName: `${sanitizedDrawingName}.thumb.png`,
                });
                thumbnailS3Key = thumbnailKey;
              } catch (thumbnailError) {
                console.error(
                  "Failed to generate PDF thumbnail:",
                  thumbnailError,
                );
              }
            }

            // Create attachment record
            const [attachment] = await db
              .insert(attachments)
              .values({
                s3Bucket: process.env.S3_BUCKET || "default-bucket",
                s3Key: drawingUploadResult.key,
                fileName: drawing.name,
                contentType: drawing.type || "application/pdf",
                fileSize: drawing.size,
                thumbnailS3Key,
                source: "user_upload",
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

    // Handle Receive PO — upload customer PO + convert quote to order
    if (intent === "receivePo") {
      if (quote.status !== "Sent") {
        return json(
          { error: "Quote must be Sent to receive a customer PO" },
          { status: 400 },
        );
      }
      if (quote.convertedToOrderId) {
        return json(
          { error: "Quote has already been converted to an order" },
          { status: 400 },
        );
      }

      const poNumberRaw = (formData.get("poNumber") as string | null) || "";
      const poNumber = poNumberRaw.trim();
      const file = formData.get("file") as File | null;

      if (!poNumber) {
        return json({ error: "PO number is required" }, { status: 400 });
      }
      if (!file || file.size <= 0) {
        return json(
          { error: "Customer PO file is required" },
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return json({ error: "File size exceeds 10MB limit" }, { status: 400 });
      }

      const { isAllowedCustomerPoFile } = await import("~/lib/customer-po");
      if (!isAllowedCustomerPoFile(file.type, file.name)) {
        return json(
          {
            error:
              "Customer PO must be a PDF or image (PNG, JPG, or WebP)",
          },
          { status: 400 },
        );
      }

      // Same conversion prechecks as Mark as Accepted
      const validationErrors: string[] = [];
      const quoteTotal = parseFloat(quote.total || "0");
      if (quoteTotal <= 0) {
        validationErrors.push(
          "Quote must have a valid total greater than $0. Please add pricing to line items.",
        );
      }
      if (!quote.lineItems || quote.lineItems.length === 0) {
        validationErrors.push("Quote must have at least one line item.");
      }
      if (quote.parts && quote.parts.length > 0) {
        const pendingConversions = quote.parts.filter(
          (part) =>
            part.conversionStatus === "in_progress" ||
            part.conversionStatus === "queued" ||
            (part.conversionStatus === "pending" && part.partFileUrl),
        );
        if (pendingConversions.length > 0) {
          validationErrors.push(
            `Cannot accept quote while ${pendingConversions.length} part(s) have pending mesh conversions.`,
          );
        }
      }
      if (validationErrors.length > 0) {
        return json(
          { error: "Cannot accept quote", validationErrors },
          { status: 400 },
        );
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const key = generateFileKey(quote.id, file.name);
        const uploadResult = await uploadFile({
          key,
          buffer,
          contentType: file.type || "application/octet-stream",
          fileName: file.name,
        });

        const attachment = await createAttachment(
          {
            s3Bucket: uploadResult.bucket,
            s3Key: uploadResult.key,
            fileName: uploadResult.fileName,
            contentType: uploadResult.contentType,
            fileSize: uploadResult.size,
            source: "user_upload",
            documentKind: "customer_purchase_order",
          },
          eventContext,
        );

        await db.insert(quoteAttachments).values({
          quoteId: quote.id,
          attachmentId: attachment.id,
        });

        if (quote.stripePaymentLinkId) {
          const stripeOn = await isStripePaymentLinksEnabled();
          if (stripeOn) {
            try {
              await deactivateQuotePaymentLink(quote.stripePaymentLinkId);
              await updateQuote(
                quote.id,
                { stripePaymentLinkActive: false },
                eventContext,
              );
            } catch (stripeError) {
              console.error("Stripe deactivation failed:", stripeError);
            }
          }
        }

        const result = await convertQuoteToOrder(quote.id, eventContext, {
          poNumber,
          viaCustomerPo: true,
          customerPoAttachmentId: attachment.id,
        });

        if (result.success && result.orderNumber) {
          return redirect(`/orders/${result.orderNumber}`);
        }

        return json(
          { error: result.error || "Failed to convert quote to order" },
          { status: 400 },
        );
      } catch (error) {
        console.error("Receive PO error:", error);
        return json(
          { error: "Failed to receive customer PO" },
          { status: 500 },
        );
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
            source: "user_upload",
          },
          eventContext,
        );

        // Link to quote
        await db.insert(quoteAttachments).values({
          quoteId: quote.id,
          attachmentId: attachment.id,
        });

        // Fetcher-based uploads request JSON so they don't navigate away
        if (formData.get("_noRedirect")) {
          return withAuthHeaders(
            json({ success: true, attachmentId: attachment.id }),
            headers,
          );
        }

        // Return a redirect to refresh the page
        return redirect(`/quotes/${quoteId}`);
      } catch (error) {
        console.error("Upload error:", error);
        return json({ error: "Failed to upload file" }, { status: 500 });
      }
    }

    // If we get here with multipart data but unhandled intent, check if it's a PDF generation
    // PDF generation uses FormData but doesn't include files, so let it fall through
    const filelessMultipartIntents = [
      "generateQuote",
      "generateInvoice",
      "emailPreview",
      "emailQueue",
    ];
    if (!filelessMultipartIntents.includes(intent as string)) {
      return json({ error: "Invalid multipart request" }, { status: 400 });
    }
    // Fall through to regular form handling for file-less multipart intents
  } else {
    // Not multipart, parse as regular FormData
    formData = await request.formData();
  }

  // Handle form submissions
  const intent = formData.get("intent");

  try {
    const partAssetAdminResponse = await tryPartAssetAdminAction(
      formData,
      { type: "quote", quoteId: quote.id },
      { user: { id: user.id }, userDetails, headers },
    );
    if (partAssetAdminResponse) {
      return partAssetAdminResponse;
    }

    switch (intent) {
      case "emailPreview": {
        return withAuthHeaders(
          await handleEmailPreviewAction({
            auth: { user, userDetails },
            formData,
            expected: {
              contextKey: EMAIL_CONTEXT.QUOTE_SEND,
              entityId: String(quote.id),
            },
          }),
          headers,
        );
      }

      case "emailQueue": {
        return withAuthHeaders(
          await handleEmailQueueAction({
            auth: { user, userDetails },
            formData,
            expected: {
              contextKey: EMAIL_CONTEXT.QUOTE_SEND,
              entityType: "quote",
              entityId: String(quote.id),
            },
          }),
          headers,
        );
      }

      case "uploadToToolpath": {
        if (!(await canUserAccessToolpath())) {
          return withAuthHeaders(
            json({ error: "Toolpath integration is not enabled" }, { status: 403 }),
            headers,
          );
        }

        if (!["Draft", "RFQ"].includes(quote.status)) {
          return withAuthHeaders(
            json(
              { error: "Toolpath uploads are only available for Draft or RFQ quotes" },
              { status: 400 },
            ),
            headers,
          );
        }

        if (!isToolpathEnabled()) {
          return withAuthHeaders(
            json({ error: "Toolpath API is not configured" }, { status: 503 }),
            headers,
          );
        }

        let payload: unknown;
        try {
          payload = JSON.parse(String(formData.get("payload") || "{}"));
        } catch {
          return withAuthHeaders(
            json({ error: "Invalid Toolpath upload payload" }, { status: 400 }),
            headers,
          );
        }

        if (
          typeof payload !== "object" ||
          payload === null ||
          !Array.isArray((payload as { selections?: unknown }).selections)
        ) {
          return withAuthHeaders(
            json({ error: "Invalid Toolpath upload payload" }, { status: 400 }),
            headers,
          );
        }

        const selections = (payload as { selections: unknown[] }).selections;
        if (selections.length === 0) {
          return withAuthHeaders(
            json({ error: "Select at least one part to upload" }, { status: 400 }),
            headers,
          );
        }

        if (selections.length > 25) {
          return withAuthHeaders(
            json({ error: "Cannot upload more than 25 parts at once" }, { status: 400 }),
            headers,
          );
        }

        const seenQuotePartIds = new Set<string>();
        for (const selection of selections) {
          if (
            typeof selection !== "object" ||
            selection === null ||
            typeof (selection as { quotePartId?: unknown }).quotePartId !== "string" ||
            typeof (selection as { cutConfigId?: unknown }).cutConfigId !== "string"
          ) {
            return withAuthHeaders(
              json({ error: "Invalid Toolpath upload selection" }, { status: 400 }),
              headers,
            );
          }

          const { quotePartId } = selection as { quotePartId: string; cutConfigId: string };
          if (seenQuotePartIds.has(quotePartId)) {
            return withAuthHeaders(
              json({ error: "Duplicate part selection in upload request" }, { status: 400 }),
              headers,
            );
          }
          seenQuotePartIds.add(quotePartId);
        }

        const validatedSelections = selections as Array<{
          quotePartId: string;
          cutConfigId: string;
        }>;

        const lineItemPartIds = new Set(
          (quote.lineItems || [])
            .map((lineItem) => lineItem.quotePartId)
            .filter((id): id is string => !!id),
        );
        const partsById = new Map((quote.parts || []).map((part) => [part.id, part]));
        const results: ToolpathUploadResult[] = [];
        let queuedCount = 0;
        let staggerIndex = 0;

        for (const selection of validatedSelections) {
          const quotePartId = selection.quotePartId;
          const cutConfigId = selection.cutConfigId;

          if (!quotePartId || !cutConfigId) {
            results.push({
              quotePartId: quotePartId || "unknown",
              partName: "Unknown part",
              success: false,
              error: "Missing part or cut config selection",
            });
            continue;
          }

          const part = partsById.get(quotePartId);
          if (!part || !lineItemPartIds.has(quotePartId)) {
            results.push({
              quotePartId,
              partName: part?.partName || "Unknown part",
              success: false,
              error: "Part is not linked to this quote's line items",
            });
            continue;
          }

          if (!part.partFileUrl) {
            results.push({
              quotePartId,
              partName: part.partName,
              success: false,
              error: "Part does not have a CAD file",
            });
            continue;
          }

          if (isToolpathUploadInFlight(part.toolpathUploadStatus)) {
            results.push({
              quotePartId,
              partName: part.partName,
              success: false,
              error: "Part upload is already in progress",
            });
            continue;
          }

          if (
            part.toolpathReportUrl &&
            isAllowedToolpathReportUrl(part.toolpathReportUrl)
          ) {
            results.push({
              quotePartId,
              partName: part.partName,
              success: false,
              error: "Part is already uploaded to Toolpath",
            });
            continue;
          }

          try {
            const [claimed] = await db
              .update(quoteParts)
              .set({
                toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.QUEUED,
                toolpathCutConfigId: cutConfigId,
                toolpathQueuedAt: new Date(),
                toolpathUploadError: null,
                toolpathUploadJobId: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(quoteParts.id, quotePartId),
                  or(
                    isNull(quoteParts.toolpathUploadStatus),
                    eq(
                      quoteParts.toolpathUploadStatus,
                      TOOLPATH_UPLOAD_STATUS.FAILED,
                    ),
                  ),
                ),
              )
              .returning({
                id: quoteParts.id,
                partName: quoteParts.partName,
              });

            if (!claimed) {
              results.push({
                quotePartId,
                partName: part.partName,
                success: false,
                error: "Part upload is already in progress",
              });
              continue;
            }

            const jobId = await sendToolpathUploadJob(
              {
                quotePartId,
                cutConfigId,
                quoteId: quote.id,
                triggeredByUserId: user.id,
              },
              {
                startAfterSeconds:
                  (staggerIndex * TOOLPATH_PART_CREATION_INTERVAL_MS) / 1000,
              },
            );

            if (!jobId) {
              await db
                .update(quoteParts)
                .set({
                  toolpathUploadStatus: null,
                  toolpathCutConfigId: null,
                  toolpathQueuedAt: null,
                  toolpathUploadJobId: null,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(quoteParts.id, quotePartId),
                    eq(
                      quoteParts.toolpathUploadStatus,
                      TOOLPATH_UPLOAD_STATUS.QUEUED,
                    ),
                  ),
                );

              logToolpathUploadAlert("Failed to enqueue Toolpath upload job", {
                quotePartId,
                quoteId: quote.id,
              });

              results.push({
                quotePartId,
                partName: part.partName,
                success: false,
                error: "Failed to queue upload job",
              });
              continue;
            }

            await db
              .update(quoteParts)
              .set({
                toolpathUploadJobId: jobId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(quoteParts.id, quotePartId),
                  eq(
                    quoteParts.toolpathUploadStatus,
                    TOOLPATH_UPLOAD_STATUS.QUEUED,
                  ),
                ),
              );

            staggerIndex += 1;
            queuedCount += 1;
            results.push({
              quotePartId,
              partName: claimed.partName,
              success: true,
            });
          } catch (error) {
            const message = formatToolpathQueueError(error);

            if (message.includes("connection limit")) {
              logToolpathUploadAlert("Toolpath enqueue hit DB connection limit", {
                quotePartId,
                quoteId: quote.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }

            try {
              await db
                .update(quoteParts)
                .set({
                  toolpathUploadStatus: null,
                  toolpathCutConfigId: null,
                  toolpathQueuedAt: null,
                  toolpathUploadJobId: null,
                  toolpathUploadError: message,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(quoteParts.id, quotePartId),
                    eq(
                      quoteParts.toolpathUploadStatus,
                      TOOLPATH_UPLOAD_STATUS.QUEUED,
                    ),
                  ),
                );
            } catch (dbError) {
              console.error(
                "Failed to revert Toolpath state after enqueue error:",
                dbError,
              );
            }

            results.push({
              quotePartId,
              partName: part.partName,
              success: false,
              error: message,
            });
          }
        }

        if (queuedCount > 0) {
          try {
            await createEvent({
              entityType: "quote",
              entityId: quote.id.toString(),
              eventType: "toolpath_upload",
              eventCategory: "manufacturing",
              title: "Toolpath upload batch queued",
              description: `Queued ${queuedCount} part(s) for Toolpath upload on quote ${quote.quoteNumber}.`,
              metadata: {
                quoteId: quote.id,
                quoteNumber: quote.quoteNumber,
                queuedCount,
                results,
              },
              userId: user.id,
              userEmail: user.email || userDetails?.email || undefined,
            });
          } catch (eventError) {
            console.error("Failed to log Toolpath queue event:", eventError);
          }
        }

        const queueErrors = results.filter((result) => !result.success);
        const success = queuedCount > 0;
        return withAuthHeaders(
          json({
            success,
            queuedCount,
            queueErrors,
            results,
            error: success
              ? undefined
              : queueErrors[0]?.error ||
                "No parts were queued for Toolpath upload",
          }),
          headers,
        );
      }

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

        // Stripe payment link creation when sending a quote
        if (status === "Sent") {
          const { transitionQuoteToSent } = await import("~/lib/quotes.server");
          const result = await transitionQuoteToSent(quote.id, eventContext);
          if (!result.success) {
            return json({ error: result.error }, { status: 400 });
          }
          return redirect(`/quotes/${quoteId}`);
        }

        // Stripe payment link deactivation on terminal statuses
        if (
          ["Accepted", "Rejected", "Expired"].includes(status) &&
          quote.stripePaymentLinkId
        ) {
          const stripeOn = await isStripePaymentLinksEnabled();
          if (stripeOn) {
            try {
              await deactivateQuotePaymentLink(quote.stripePaymentLinkId);
              await updateQuote(
                quote.id,
                { stripePaymentLinkActive: false },
                eventContext,
              );
            } catch (stripeError) {
              console.error("Stripe deactivation failed:", stripeError);
            }
          }
        }

        // If status is Accepted, validate and convert to order BEFORE updating status
        if (status === "Accepted") {
          // Validate quote before conversion
          const validationErrors = [];

          // Check quote has valid pricing
          const quoteTotal = parseFloat(quote.total || "0");
          if (quoteTotal <= 0) {
            validationErrors.push(
              "Quote must have a valid total greater than $0. Please add pricing to line items.",
            );
          }

          // Check quote has line items
          if (!quote.lineItems || quote.lineItems.length === 0) {
            validationErrors.push("Quote must have at least one line item.");
          }

          // Check for pending mesh conversions
          if (quote.parts && quote.parts.length > 0) {
            const pendingConversions = quote.parts.filter(
              (part) =>
                part.conversionStatus === "in_progress" ||
                part.conversionStatus === "queued" ||
                (part.conversionStatus === "pending" && part.partFileUrl),
            );
            if (pendingConversions.length > 0) {
              validationErrors.push(
                `Cannot accept quote while ${pendingConversions.length} part(s) have pending mesh conversions.`,
              );
            }
          }

          // If validation fails, return errors without changing status
          if (validationErrors.length > 0) {
            return json(
              {
                error: "Cannot accept quote",
                validationErrors,
              },
              { status: 400 },
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
            { status: 400 },
          );
        }

        // For all other status changes, update normally
        await updateQuote(
          quote.id,
          {
            status,
            rejectionReason: status === "Rejected" ? rejectionReason : null,
          },
          eventContext,
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
              { status: 400 },
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
          eventContext,
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
          eventContext,
        );
        return json({ success: true });
      }

      case "updateEstimatedDelivery": {
        await autoConvertRFQToDraft();

        const minStr = formData.get("leadTimeBusinessDaysMin") as string;
        const maxStr = formData.get("leadTimeBusinessDaysMax") as string;
        const min = parseInt(minStr, 10);
        const max = parseInt(maxStr, 10);

        if (isNaN(min) || isNaN(max) || min < 0 || max < min) {
          return json(
            { error: "Invalid lead time business day range" },
            { status: 400 },
          );
        }

        const today = startOfTodayInAppTz();
        const start = addBusinessDays(today, min);
        const end = addBusinessDays(today, max);

        await updateQuote(
          quote.id,
          {
            leadTimeBusinessDaysMin: min,
            leadTimeBusinessDaysMax: max,
            estimatedDeliveryDateStart: start,
            estimatedDeliveryDateEnd: end,
          },
          eventContext,
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
            { status: 400 },
          );
        }

        await updateQuote(
          quote.id,
          { validUntil: new Date(validUntil) },
          eventContext,
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
          { status: 400 },
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
            { status: 400 },
          );
        }

        const oldStatus = quote.status;

        // Deactivate existing Stripe payment link if one is active
        if (quote.stripePaymentLinkId && quote.stripePaymentLinkActive) {
          const stripeOn = await isStripePaymentLinksEnabled();
          if (stripeOn) {
            try {
              await deactivateQuotePaymentLink(quote.stripePaymentLinkId);
            } catch (stripeError) {
              console.error(
                "Stripe payment link deactivation failed during revision:",
                stripeError,
              );
            }
          }
        }

        // Manually update quote status to Draft and clear Stripe payment link fields
        await db
          .update(quotes)
          .set({
            status: "Draft",
            stripePaymentLinkUrl: null,
            stripePaymentLinkId: null,
            stripePaymentLinkActive: null,
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

      case "duplicateQuote": {
        const result = await duplicateQuote(quote.id, eventContext);
        if (result.success && result.quoteNumber) {
          return redirect(`/quotes/${result.quoteId}`);
        }
        return json(
          { error: result.error || "Failed to duplicate quote" },
          { status: 400 },
        );
      }

      case "updateLineItem": {
        // Auto-convert RFQ to Draft when editing starts
        await autoConvertRFQToDraft();

        const lineItemId = formData.get("lineItemId") as string;

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        const lineItemIdNum = parseInt(lineItemId, 10);
        if (Number.isNaN(lineItemIdNum)) {
          return json({ error: "Invalid line item ID" }, { status: 400 });
        }

        const [lineRow] = await db
          .select()
          .from(quoteLineItems)
          .where(eq(quoteLineItems.id, lineItemIdNum))
          .limit(1);

        if (!lineRow || lineRow.quoteId !== quote.id) {
          return json({ error: "Line item not found" }, { status: 404 });
        }

        const allQuoteLines = await db
          .select()
          .from(quoteLineItems)
          .where(
            and(
              eq(quoteLineItems.quoteId, quote.id),
              eq(quoteLineItems.isArchived, false),
            ),
          );

        const positiveSub = quotePositiveSubtotalExcluding(
          allQuoteLines,
          lineItemIdNum,
        );

        const { updateQuoteLineItem } = await import("~/lib/quotes");

        const updateData: {
          quantity?: number;
          unitPrice?: number;
          description?: string;
          notes?: string;
          name?: string;
        } = {};

        const quantityRaw = formData.get("quantity") as string | null;
        const unitPriceRaw = formData.get("unitPrice") as string | null;
        const totalPriceRaw = formData.get("totalPrice") as string | null;
        const description = formData.get("description") as string | null;
        const notes = formData.get("notes") as string | null;
        const nameRaw = formData.get("name") as string | null;

        const qty =
          quantityRaw !== null && quantityRaw !== ""
            ? parseInt(quantityRaw, 10)
            : lineRow.quantity;

        if (quantityRaw !== null && quantityRaw !== "") {
          if (Number.isNaN(qty) || qty <= 0) {
            return json({ error: "Invalid quantity" }, { status: 400 });
          }
          updateData.quantity = qty;
        }

        const isPartLinked = lineRow.quotePartId != null;

        if (totalPriceRaw !== null && totalPriceRaw !== "") {
          const parsedTotal = parseLineTotalInput(totalPriceRaw, {
            quantity: qty,
            positiveSubtotal: positiveSub,
            isPartLinked,
          });
          if (!parsedTotal.ok) {
            return json({ error: parsedTotal.error }, { status: 400 });
          }
          if (qty <= 0) {
            return json({ error: "Invalid quantity" }, { status: 400 });
          }
          updateData.unitPrice = parsedTotal.totalPrice / qty;
        } else if (unitPriceRaw !== null && unitPriceRaw !== "") {
          const parsedUnit = parseUnitPriceInput(unitPriceRaw, {
            quantity: qty,
            positiveSubtotal: positiveSub,
            isPartLinked,
          });
          if (!parsedUnit.ok) {
            return json({ error: parsedUnit.error }, { status: 400 });
          }
          updateData.unitPrice = parsedUnit.unitPrice;
        }

        if (description !== null) {
          updateData.description = description || "";
        }
        if (notes !== null) {
          updateData.notes = notes || "";
        }
        if (nameRaw !== null) {
          updateData.name = String(nameRaw).trim();
        }

        await updateQuoteLineItem(lineItemIdNum, updateData, eventContext);

        const { calculateQuoteTotals } = await import("~/lib/quotes");
        const updatedTotals = await calculateQuoteTotals(quote.id);

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
          noteEventContext,
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
            { status: 400 },
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

      case "archiveLineItem": {
        await autoConvertRFQToDraft();

        const lineItemId = formData.get("lineItemId") as string;
        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        try {
          await archiveQuoteLineItem(
            parseInt(lineItemId, 10),
            quote.id,
            eventContext,
          );
          return redirect(`/quotes/${quoteId}`);
        } catch (error) {
          console.error("Error archiving line item:", error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to archive line item",
            },
            { status: 500 },
          );
        }
      }

      case "restoreLineItem": {
        const lineItemId = formData.get("lineItemId") as string;
        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        try {
          await restoreQuoteLineItem(
            parseInt(lineItemId, 10),
            quote.id,
            eventContext,
          );
          return redirect(`/quotes/${quoteId}`);
        } catch (error) {
          console.error("Error restoring line item:", error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to restore line item",
            },
            { status: 500 },
          );
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

        if (quotePartUsesPlaceholderCad(quotePart.specifications)) {
          return json(
            {
              error:
                "Preview mesh is managed in Settings. Upload a CAD file to regenerate mesh for this part.",
            },
            { status: 400 },
          );
        }

        if (!quotePart.partFileUrl) {
          return json(
            { error: "No source file available for conversion" },
            { status: 400 },
          );
        }

        // Trigger mesh conversion
        const { triggerQuotePartMeshConversion } =
          await import("~/lib/quote-part-mesh-converter.server");

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
          quotePart.partFileUrl,
        ).catch(async (error) => {
          console.error(
            `Failed to regenerate mesh for quote part ${quotePart.id}:`,
            error,
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

      case "updateQuotePartAttributes": {
        const quotePartId = formData.get("quotePartId") as string;
        const material = formData.get("material") as string;
        const tolerance = formData.get("tolerance") as string;
        const finish = formData.get("finish") as string;

        if (!quotePartId) {
          return json({ error: "Quote part ID is required" }, { status: 400 });
        }

        // Get current quote part to retrieve old values for comparison
        const { quoteParts } = await import("~/lib/db/schema");
        const [currentQuotePart] = await db
          .select()
          .from(quoteParts)
          .where(eq(quoteParts.id, quotePartId))
          .limit(1);

        if (!currentQuotePart) {
          return json({ error: "Quote part not found" }, { status: 404 });
        }

        // Normalize values (treat empty string as null)
        const normalizeMaterial = material?.trim() || null;
        const normalizeTolerance = tolerance?.trim() || null;
        const normalizeFinish = finish?.trim() || null;

        // Update the quote part in the database
        await db
          .update(quoteParts)
          .set({
            material: normalizeMaterial,
            tolerance: normalizeTolerance,
            finish: normalizeFinish,
            updatedAt: new Date(),
          })
          .where(eq(quoteParts.id, quotePartId));

        // Create individual events only for changed attributes
        // Material change event
        if (normalizeMaterial !== currentQuotePart.material) {
          await createEvent({
            entityType: "quote",
            entityId: quote.id.toString(),
            eventType: "quote_part_material_changed",
            eventCategory: "manufacturing",
            title: "Quote Part Material Changed",
            description: `${currentQuotePart.partName || "Part"} changed to ${
              normalizeMaterial || "no material"
            }`,
            metadata: {
              partName: currentQuotePart.partName,
              quotePartId,
              quoteId: quote.id,
              quoteNumber: quote.quoteNumber,
              oldValue: currentQuotePart.material,
              newValue: normalizeMaterial,
              field: "material",
            },
            userId: eventContext.userId,
            userEmail: eventContext.userEmail,
          });
        }

        // Tolerance change event
        if (normalizeTolerance !== currentQuotePart.tolerance) {
          await createEvent({
            entityType: "quote",
            entityId: quote.id.toString(),
            eventType: "quote_part_tolerance_changed",
            eventCategory: "manufacturing",
            title: "Quote Part Tolerance Changed",
            description: `${currentQuotePart.partName || "Part"} changed to ${
              normalizeTolerance || "no tolerance"
            }`,
            metadata: {
              partName: currentQuotePart.partName,
              quotePartId,
              quoteId: quote.id,
              quoteNumber: quote.quoteNumber,
              oldValue: currentQuotePart.tolerance,
              newValue: normalizeTolerance,
              field: "tolerance",
            },
            userId: eventContext.userId,
            userEmail: eventContext.userEmail,
          });
        }

        // Finish change event
        if (normalizeFinish !== currentQuotePart.finish) {
          await createEvent({
            entityType: "quote",
            entityId: quote.id.toString(),
            eventType: "quote_part_finish_changed",
            eventCategory: "manufacturing",
            title: "Quote Part Finish Changed",
            description: `${currentQuotePart.partName || "Part"} changed to ${
              normalizeFinish || "no finish"
            }`,
            metadata: {
              partName: currentQuotePart.partName,
              quotePartId,
              quoteId: quote.id,
              quoteNumber: quote.quoteNumber,
              oldValue: currentQuotePart.finish,
              newValue: normalizeFinish,
              field: "finish",
            },
            userId: eventContext.userId,
            userEmail: eventContext.userEmail,
          });
        }

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
          user?.id || userDetails?.id,
        );

        if (
          quote.leadTimeBusinessDaysMin == null &&
          quote.leadTimeBusinessDaysMax == null &&
          calculationData.leadTimeOption
        ) {
          const { min, max } = leadTimeOptionToBusinessDays(
            calculationData.leadTimeOption as string,
          );
          const today = startOfTodayInAppTz();
          await updateQuote(
            quote.id,
            {
              leadTimeBusinessDaysMin: min,
              leadTimeBusinessDaysMax: max,
              estimatedDeliveryDateStart: addBusinessDays(today, min),
              estimatedDeliveryDateEnd: addBusinessDays(today, max),
            },
            eventContext,
          );
        }

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
            documentKind: "quote",
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
          return json(
            {
              error:
                pdfError instanceof Error
                  ? pdfError.message
                  : "Failed to generate PDF",
            },
            { status: 500 },
          );
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
            documentKind: "invoice",
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
          return json(
            {
              error:
                pdfError instanceof Error
                  ? pdfError.message
                  : "Failed to generate PDF",
            },
            { status: 500 },
          );
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
    canAccessPriceCalculator,
    pdfAutoDownload,
    rejectionReasonRequired,
    events,
    convertedOrder,
    canRevise,
    bananaEnabled,
    bananaModelUrl,
    stripeEnabled,
    outboundEmailEnabled,
    hideLineItemThumbnails,
    canAccessToolpath,
    quoteSendEmailReady,
    quoteSendEmailDefaultSubject,
    quoteSendEditableSlots,
    quoteSendRequiredAttachmentDocumentKinds,
    archivedLineItems,
    archiveRetentionDays,
  } = useLoaderData<typeof loader>();
  const partAssetAdminAction = usePartAssetAdminAccess()
    ? `/quotes/${quote.id}`
    : undefined;
  const fetcher = useFetcher();
  const receivePoFetcher = useFetcher<ReceivePoActionData>();
  const revalidator = useRevalidator();
  const [isAddingNote, setIsAddingNote] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const emailPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [emailPollCount, setEmailPollCount] = useState(0);
  const [isWaitingForSentStatus, setIsWaitingForSentStatus] = useState(false);
  const [isAddLineItemModalOpen, setIsAddLineItemModalOpen] = useState(false);
  const [promoteLineItemTarget, setPromoteLineItemTarget] = useState<{
    id: number;
    name: string;
    quantity: number;
    unitPrice: string;
    totalPrice?: string;
    description?: string;
    notes?: string;
  } | null>(null);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isSendEmailModalOpen, setSendEmailModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isCustomerInfoModalOpen, setIsCustomerInfoModalOpen] = useState(false);
  const [isLeadTimeModalOpen, setIsLeadTimeModalOpen] = useState(false);
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

  const [optimisticLineItems, setOptimisticLineItems] = useState<
    LineItem[] | undefined
  >(quote.lineItems as LineItem[] | undefined);

  const quotePositiveSubForAddLineModal = useMemo(
    () =>
      quotePositiveSubtotalExcluding(
        (optimisticLineItems ?? []).map((li) => ({
          id: li.id,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          totalPrice: li.totalPrice,
        })),
      ),
    [optimisticLineItems],
  );

  const [optimisticTotal, setOptimisticTotal] = useState(quote.total || "0.00");
  const [editingExpirationDays, setEditingExpirationDays] = useState(false);
  const [expirationDaysValue, setExpirationDaysValue] = useState(
    (quote.expirationDays || 14).toString(),
  );
  const [editingValidUntil, setEditingValidUntil] = useState(false);
  const [validUntilValue, setValidUntilValue] = useState(
    quote.validUntil
      ? new Date(quote.validUntil).toISOString().split("T")[0]
      : "",
  );
  const lineItemFetcher = useFetcher();
  const restoreLineItemFetcher = useFetcher();
  const [restoringArchivedLineItemId, setRestoringArchivedLineItemId] =
    useState<number | null>(null);
  const drawingFetcher = useFetcher();
  const [selectedDrawing, setSelectedDrawing] = useState<{
    drawing: NormalizedDrawing;
    quotePartId: string;
  } | null>(null);
  const [drawingModalOpen, setDrawingModalOpen] = useState(false);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [currentCalculatorPartIndex, setCurrentCalculatorPartIndex] =
    useState(0);
  const [calculatorMode, setCalculatorMode] = useState<
    "allParts" | "singlePart"
  >("allParts");
  const calculatorFetcher = useFetcher<{
    success?: boolean;
    error?: string;
  }>();
  const toolpathFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    queuedCount?: number;
    queueErrors?: ToolpathUploadResult[];
    results?: ToolpathUploadResult[];
  }>();
  const [isToolpathModalOpen, setIsToolpathModalOpen] = useState(false);
  const [toolpathModalSession, setToolpathModalSession] = useState(0);
  const [toolpathResultsSession, setToolpathResultsSession] = useState<
    number | null
  >(null);
  const [lastHandledToolpathData, setLastHandledToolpathData] =
    useState<unknown>(null);
  const { download, isDownloading } = useDownload({
    onError: (err) => {
      console.error("Download error:", err);
      alert("Failed to download files. Please try again.");
    },
  });
  const [isGeneratePdfModalOpen, setIsGeneratePdfModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isReceivePoModalOpen, setIsReceivePoModalOpen] = useState(false);
  const [part3DModalOpen, setPart3DModalOpen] = useState(false);
  const [selectedPart3D, setSelectedPart3D] = useState<{
    partId: string;
    quotePartId: string;
    partName: string;
    modelUrl?: string;
    solidModelUrl?: string;
    cadFileUrl?: string;
    thumbnailUrl?: string;
    conversionStatus?: string | null;
    meshConversionError?: string | null;
    usesPlaceholderCad?: boolean;
  } | null>(null);

  // Granular locking for different sections
  const areNotesLocked = ["Accepted", "Rejected", "Expired"].includes(
    quote.status,
  );
  const areAttachmentsLocked = ["Accepted", "Rejected", "Expired"].includes(
    quote.status,
  );
  const isPricingLocked = ["Sent", "Accepted", "Rejected", "Expired"].includes(
    quote.status,
  );
  const areDetailsLocked = ["Sent", "Accepted", "Rejected", "Expired"].includes(
    quote.status,
  );
  const quoteLeadTimeDisplay =
    quote.leadTimeBusinessDaysMin != null &&
    quote.leadTimeBusinessDaysMax != null
      ? formatLeadTimeBusinessDays(
          quote.leadTimeBusinessDaysMin,
          quote.leadTimeBusinessDaysMax,
        )
      : "Not set";

  // Check if any parts are currently converting
  const hasConvertingParts = quote.parts?.some(
    (part: { conversionStatus: string | null }) =>
      part.conversionStatus === "in_progress" ||
      part.conversionStatus === "queued" ||
      part.conversionStatus === "pending",
  );

  const hasToolpathUploadInProgress = quote.parts?.some(
    (part: { toolpathUploadStatus?: string | null }) =>
      isToolpathUploadInFlight(part.toolpathUploadStatus),
  );

  const toolpathHasFailures = quote.parts?.some(
    (part: { toolpathUploadError?: string | null }) => !!part.toolpathUploadError,
  );

  const toolpathIsProcessing = hasToolpathUploadInProgress;

  // Set up polling for parts conversion status
  // Using a ref for the interval to avoid stale closure issues in cleanup
  useEffect(() => {
    const MAX_POLL_COUNT = 120; // Max 10 minutes (120 * 5 seconds)

    if (
      (hasConvertingParts || hasToolpathUploadInProgress) &&
      !pollIntervalRef.current &&
      pollCount < MAX_POLL_COUNT
    ) {
      pollIntervalRef.current = setInterval(() => {
        setPollCount((prev) => prev + 1);
        revalidator.revalidate();
      }, 5000);
    } else if (
      !hasConvertingParts &&
      !hasToolpathUploadInProgress &&
      pollIntervalRef.current
    ) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      setPollCount(0);
    } else if (pollCount >= MAX_POLL_COUNT && pollIntervalRef.current) {
      console.warn("Background status polling timeout reached (10 minutes)");
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      setPollCount(0);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [
    hasConvertingParts,
    hasToolpathUploadInProgress,
    pollCount,
    revalidator,
  ]);

  // Poll for quote status change after queueing an email send
  useEffect(() => {
    const MAX_EMAIL_POLL_COUNT = 40; // ~2 minutes at 3s interval

    if (!isWaitingForSentStatus) {
      if (emailPollIntervalRef.current) {
        clearInterval(emailPollIntervalRef.current);
        emailPollIntervalRef.current = null;
      }
      return;
    }

    if (quote.status === "Sent") {
      setIsWaitingForSentStatus(false);
      setEmailPollCount(0);
      if (emailPollIntervalRef.current) {
        clearInterval(emailPollIntervalRef.current);
        emailPollIntervalRef.current = null;
      }
      return;
    }

    if (
      !emailPollIntervalRef.current &&
      emailPollCount < MAX_EMAIL_POLL_COUNT
    ) {
      emailPollIntervalRef.current = setInterval(() => {
        setEmailPollCount((prev) => prev + 1);
        revalidator.revalidate();
      }, 3000);
    } else if (emailPollCount >= MAX_EMAIL_POLL_COUNT) {
      setIsWaitingForSentStatus(false);
      setEmailPollCount(0);
      if (emailPollIntervalRef.current) {
        clearInterval(emailPollIntervalRef.current);
        emailPollIntervalRef.current = null;
      }
    }

    return () => {
      if (emailPollIntervalRef.current) {
        clearInterval(emailPollIntervalRef.current);
        emailPollIntervalRef.current = null;
      }
    };
  }, [emailPollCount, isWaitingForSentStatus, quote.status, revalidator]);

  // Update optimistic line items when the actual data changes
  // Sort so part line items (quotePartId != null) appear before additional services,
  // and items within each group are stable by id
  useEffect(() => {
    const items = quote.lineItems as LineItem[] | undefined;
    if (items) {
      const sorted = [...items].sort((a, b) => {
        // Part items first (non-null quotePartId), additional services last
        const aHasPart = a.quotePartId ? 0 : 1;
        const bHasPart = b.quotePartId ? 0 : 1;
        if (aHasPart !== bHasPart) return aHasPart - bHasPart;
        // Within each group, stable by id (creation order)
        return a.id - b.id;
      });
      setOptimisticLineItems(sorted);
    } else {
      setOptimisticLineItems(undefined);
    }
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
        0,
      );
      setOptimisticTotal(total.toFixed(2));
    }
  }, [optimisticLineItems]);

  const normalizedLineItems = useMemo(
    () =>
      normalizeQuoteLineItems(
        (optimisticLineItems || []) as Array<{
          id: number;
          quotePartId: string | null;
          name: string | null;
          description: string | null;
          notes: string | null;
          quantity: number;
          unitPrice: string;
          totalPrice: string;
        }>,
        (quote.parts || []) as Array<{
          id: string;
          partName: string;
          material: string | null;
          tolerance: string | null;
          finish: string | null;
          conversionStatus: string | null;
          meshConversionError?: string | null;
          partFileUrl?: string | null;
          toolpathPartId?: string | null;
          toolpathReportUrl?: string | null;
          toolpathUploadError?: string | null;
          toolpathUploadStatus?: string | null;
          signedFileUrl?: string;
          signedMeshUrl?: string;
          signedThumbnailUrl?: string;
          usesPlaceholderCad?: boolean;
          drawings?: Array<{
            id: string;
            fileName: string;
            contentType: string | null;
            fileSize: number | null;
          }>;
        }>,
      ),
    [optimisticLineItems, quote.parts],
  );

  const toolpathUploadableParts = useMemo(() => {
    const lineItemPartIds = new Set(
      (optimisticLineItems || [])
        .map((lineItem) => lineItem.quotePartId)
        .filter((id): id is string => !!id),
    );
    const parts = (quote.parts || []) as Array<{
      id: string;
      partName: string;
      material: string | null;
      partFileUrl: string | null;
      toolpathPartId?: string | null;
      toolpathReportUrl?: string | null;
      toolpathUploadError?: string | null;
      toolpathUploadStatus?: string | null;
    }>;

    return parts
      .filter(
        (part) =>
          lineItemPartIds.has(part.id) &&
          !!part.partFileUrl &&
          !isToolpathUploadInFlight(part.toolpathUploadStatus) &&
          !(
            part.toolpathReportUrl &&
            isAllowedToolpathReportUrl(part.toolpathReportUrl)
          ),
      )
      .map((part) => ({
        id: part.id,
        partName: part.partName,
        material: part.material,
        previousError: part.toolpathUploadError,
      }));
  }, [optimisticLineItems, quote.parts]);

  // Track if we've handled the last fetcher response to prevent re-triggering
  const [lastHandledFetcherData, setLastHandledFetcherData] =
    useState<unknown>(null);

  // Monitor calculator fetcher state to handle success/error
  useEffect(() => {
    // Skip if we've already handled this response
    if (calculatorFetcher.data === lastHandledFetcherData) {
      return;
    }

    // When fetcher completes successfully, revalidate data
    // Note: Modal closing is handled by the modal component itself:
    // - In singlePart mode: closes immediately after save
    // - In allParts mode: closes when user clicks "Save & Close" on last part
    if (calculatorFetcher.state === "idle" && calculatorFetcher.data?.success) {
      setLastHandledFetcherData(calculatorFetcher.data);
      revalidator.revalidate();
    }

    // Handle errors
    if (calculatorFetcher.state === "idle" && calculatorFetcher.data?.error) {
      setLastHandledFetcherData(calculatorFetcher.data);
      alert(`Failed to save calculation: ${calculatorFetcher.data.error}`);
    }
  }, [
    calculatorFetcher.state,
    calculatorFetcher.data,
    revalidator,
    lastHandledFetcherData,
  ]);

  useEffect(() => {
    if (
      toolpathFetcher.state !== "idle" ||
      !toolpathFetcher.data ||
      toolpathFetcher.data === lastHandledToolpathData
    ) {
      return;
    }

    setLastHandledToolpathData(toolpathFetcher.data);

    revalidator.revalidate();
  }, [
    toolpathFetcher.state,
    toolpathFetcher.data,
    lastHandledToolpathData,
    revalidator,
  ]);

  const handleView3DModel = (part: {
    id: string;
    partName: string;
    signedMeshUrl?: string;
    signedFileUrl?: string;
    signedThumbnailUrl?: string;
    partFileUrl?: string | null;
    conversionStatus?: string | null;
    meshConversionError?: string | null;
    usesPlaceholderCad?: boolean;
  }) => {
    // Open if there is mesh/CAD, or drawing-only placeholder rows (no mesh until CAD is uploaded)
    if (
      part.signedMeshUrl ||
      part.signedFileUrl ||
      part.partFileUrl ||
      part.usesPlaceholderCad
    ) {
      setSelectedPart3D({
        partId: part.id,
        quotePartId: part.id,
        partName: part.partName,
        modelUrl: part.signedMeshUrl,
        solidModelUrl: part.signedFileUrl,
        cadFileUrl: part.partFileUrl || part.signedFileUrl,
        thumbnailUrl: part.signedThumbnailUrl,
        conversionStatus: part.conversionStatus,
        meshConversionError: part.meshConversionError,
        usesPlaceholderCad: part.usesPlaceholderCad,
      });
      setPart3DModalOpen(true);
    }
  };

  const handleReviseQuote = () => {
    if (
      confirm(
        "Are you sure you want to revise this quote? This will revert the quote to Draft status and allow editing again.",
      )
    ) {
      fetcher.submit({ intent: "reviseQuote" }, { method: "post" });
    }
  };

  const handleDuplicateQuote = () => {
    if (
      confirm(
        "Create a duplicate of this quote? A new quote with a fresh quote number will be created.",
      )
    ) {
      fetcher.submit({ intent: "duplicateQuote" }, { method: "post" });
    }
  };

  const handleMarkAsSent = () => {
    if (
      confirm(
        "Are you sure you want to mark this quote as sent? Once sent, the quote will be locked and line items cannot be modified.",
      )
    ) {
      fetcher.submit(
        {
          intent: "updateStatus",
          status: "Sent",
          rejectionReason: "",
        },
        { method: "post" },
      );
    }
  };

  const handleMarkAsAccepted = () => {
    if (
      confirm(
        "Are you sure you want to mark this quote as accepted? This will automatically convert the quote to an order and the quote will become permanently immutable.",
      )
    ) {
      fetcher.submit(
        {
          intent: "updateStatus",
          status: "Accepted",
          rejectionReason: "",
        },
        { method: "post" },
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
      { method: "post" },
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

  const handlePromoteLineItemSubmit = (formData: FormData) => {
    formData.append("intent", "promoteLineItemToQuotePart");
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
    setPromoteLineItemTarget(null);
  };

  const handleOpenCalculator = () => {
    if (!canAccessPriceCalculator) return;
    setCalculatorMode("allParts");
    setIsCalculatorOpen(true);
    setCurrentCalculatorPartIndex(0);
  };

  const handleOpenToolpath = () => {
    setToolpathModalSession((session) => session + 1);
    setToolpathResultsSession(null);
    setIsToolpathModalOpen(true);
  };

  const handleToolpathUpload = (selections: ToolpathUploadSelection[]) => {
    if (toolpathFetcher.state !== "idle") return;

    setToolpathResultsSession(toolpathModalSession);

    const formData = new FormData();
    formData.append("intent", "uploadToToolpath");
    formData.append("payload", JSON.stringify({ selections }));

    toolpathFetcher.submit(formData, { method: "post" });
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
    const partIndex =
      quote.parts?.findIndex((p: { id: string }) => p.id === partId) ?? 0;
    setCalculatorMode("singlePart");
    setCurrentCalculatorPartIndex(partIndex);
    setIsCalculatorOpen(true);
  };

  const handleDownloadFiles = () => {
    download(
      `/download/quote/${quote.id}`,
      `Quote-${quote.quoteNumber}-Files.zip`,
    );
  };

  const handleSaveCalculation = (calculationData: Record<string, unknown>) => {
    // Don't submit if already submitting
    if (calculatorFetcher.state !== "idle") {
      return;
    }

    const formData = new FormData();
    formData.append("intent", "savePriceCalculation");
    formData.append("calculationData", JSON.stringify(calculationData));

    calculatorFetcher.submit(formData, {
      method: "post",
    });

    // Modal closing is handled by the useEffect that monitors calculatorFetcher.state
  };

  const handleDeleteLineItem = (lineItemId: number) => {
    if (
      confirm(
        `Archive this line item? It will be kept for ${archiveRetentionDays} day(s) and can be restored from Archived before permanent deletion.`,
      )
    ) {
      fetcher.submit(
        {
          intent: "archiveLineItem",
          lineItemId: lineItemId.toString(),
        },
        { method: "post" },
      );
    }
  };

  const handleRestoreArchivedLineItem = (lineItemId: number) => {
    setRestoringArchivedLineItemId(lineItemId);
    restoreLineItemFetcher.submit(
      {
        intent: "restoreLineItem",
        lineItemId: lineItemId.toString(),
      },
      { method: "post" },
    );
  };

  const handleSaveLineItemField = useCallback(
    (
      lineItemId: number,
      field:
        | "name"
        | "description"
        | "notes"
        | "quantity"
        | "unitPrice"
        | "totalPrice",
      value: string,
    ) => {
      const currentItem = optimisticLineItems?.find(
        (item) => item.id === lineItemId,
      );
      if (!currentItem) return;

      if (field === "name") {
        const trimmed = value.trim();
        if (!trimmed) {
          alert("Name is required");
          return;
        }
      }

      const updatedItem: Partial<LineItem> = {};
      if (field === "name") updatedItem.name = value.trim();
      if (field === "description") updatedItem.description = value || null;
      if (field === "notes") updatedItem.notes = value || null;

      const positiveSub = quotePositiveSubtotalExcluding(
        (optimisticLineItems || []).map((li) => ({
          id: li.id,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          totalPrice: li.totalPrice,
        })),
        lineItemId,
      );
      const isPartLinked = currentItem.quotePartId != null;

      if (field === "quantity") {
        const qty = parseInt(value, 10);
        if (Number.isNaN(qty) || qty <= 0) return;
        updatedItem.quantity = qty;
        const unitPrice = parseFloat(currentItem.unitPrice || "0");
        updatedItem.totalPrice = (qty * unitPrice).toFixed(2);
      }

      if (field === "unitPrice") {
        const qty = updatedItem.quantity ?? currentItem.quantity;
        const parsed = parseUnitPriceInput(value, {
          quantity: qty,
          positiveSubtotal: positiveSub,
          isPartLinked,
        });
        if (!parsed.ok) return;
        updatedItem.unitPrice = parsed.unitPrice.toFixed(2);
        updatedItem.totalPrice = (qty * parsed.unitPrice).toFixed(2);
      }

      if (field === "totalPrice") {
        const qty = updatedItem.quantity ?? currentItem.quantity;
        const parsed = parseLineTotalInput(value, {
          quantity: qty,
          positiveSubtotal: positiveSub,
          isPartLinked,
        });
        if (!parsed.ok) return;
        updatedItem.totalPrice = parsed.totalPrice.toFixed(2);
        if (qty > 0) {
          updatedItem.unitPrice = (parsed.totalPrice / qty).toFixed(2);
        }
      }

      setOptimisticLineItems((prevItems) =>
        prevItems?.map((item) =>
          item.id === lineItemId ? { ...item, ...updatedItem } : item,
        ),
      );

      const formData = new FormData();
      formData.append("intent", "updateLineItem");
      formData.append("lineItemId", lineItemId.toString());
      if (updatedItem.name !== undefined)
        formData.append("name", updatedItem.name ?? "");
      if (updatedItem.description !== undefined)
        formData.append("description", updatedItem.description || "");
      if (updatedItem.notes !== undefined)
        formData.append("notes", updatedItem.notes || "");
      if (updatedItem.quantity !== undefined)
        formData.append("quantity", updatedItem.quantity.toString());
      if (updatedItem.unitPrice !== undefined)
        formData.append("unitPrice", updatedItem.unitPrice);
      if (updatedItem.totalPrice !== undefined)
        formData.append("totalPrice", updatedItem.totalPrice);
      lineItemFetcher.submit(formData, { method: "post" });
    },
    [lineItemFetcher, optimisticLineItems],
  );

  const handleSaveQuotePartAttribute = useCallback(
    (
      partId: string,
      field: "material" | "tolerance" | "finish",
      value: string,
    ) => {
      const part = quote.parts?.find((p: { id: string }) => p.id === partId);
      if (!part) return;
      const formData = new FormData();
      formData.append("intent", "updateQuotePartAttributes");
      formData.append("quotePartId", partId);
      formData.append(
        "material",
        field === "material" ? value : part.material || "",
      );
      formData.append(
        "tolerance",
        field === "tolerance" ? value : part.tolerance || "",
      );
      formData.append("finish", field === "finish" ? value : part.finish || "");
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher, quote.parts],
  );

  const handleQuoteDrawingUpload = useCallback(
    (partId: string, files: FileList) => {
      const formData = new FormData();
      formData.append("intent", "addDrawingToExistingPart");
      formData.append("quotePartId", partId);
      Array.from(files).forEach((file, index) => {
        formData.append(`drawing_${index}`, file);
      });
      formData.append("drawingCount", files.length.toString());
      drawingFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [drawingFetcher],
  );

  const handleQuoteDrawingDelete = useCallback(
    (drawingId: string, quotePartId: string) => {
      const formData = new FormData();
      formData.append("intent", "deleteDrawing");
      formData.append("drawingId", drawingId);
      formData.append("quotePartId", quotePartId);
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher],
  );

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
        (validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
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
                  {toolpathHasFailures ? (
                    <span
                      className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-900"
                      title="Toolpath upload failed for one or more parts"
                      aria-hidden
                    />
                  ) : null}
                  <QuoteActionsDropdown
                    isOpen={isActionsDropdownOpen}
                    onClose={() => setIsActionsDropdownOpen(false)}
                    excludeRef={actionsButtonRef}
                    quoteStatus={quote.status}
                    onReviseQuote={handleReviseQuote}
                    onDuplicate={handleDuplicateQuote}
                    onCalculatePricing={
                      canAccessPriceCalculator
                        ? handleOpenCalculator
                        : undefined
                    }
                    onOpenToolpath={
                      canAccessToolpath ? handleOpenToolpath : undefined
                    }
                    isToolpathDisabled={
                      toolpathIsProcessing ||
                      toolpathUploadableParts.length === 0
                    }
                    toolpathDisabledReason={
                      toolpathIsProcessing
                        ? "Toolpath upload already in progress"
                        : "All parts already uploaded or missing CAD files"
                    }
                    toolpathHasFailures={toolpathHasFailures}
                    toolpathIsProcessing={toolpathIsProcessing}
                    onDownloadFiles={handleDownloadFiles}
                    onGeneratePdf={handleGeneratePdf}
                    onGenerateInvoice={handleGenerateInvoice}
                    onReceivePo={
                      quote.status === "Sent"
                        ? () => setIsReceivePoModalOpen(true)
                        : undefined
                    }
                    isDownloading={isDownloading}
                    hasCustomer={!!quote.customerId}
                  />
                </div>
                {(quote.status === "RFQ" || quote.status === "Draft") && (
                  <>
                    <Button
                      onClick={handleMarkAsSent}
                      variant="secondary"
                      className="!border-blue-600 !text-blue-600 hover:!bg-blue-50 dark:!border-blue-500 dark:!text-blue-400 dark:hover:!bg-blue-900/20"
                    >
                      Mark as Sent
                    </Button>
                    {outboundEmailEnabled && (
                      <Button
                        onClick={() => setSendEmailModalOpen(true)}
                        variant="primary"
                        disabled={
                          !customer?.email ||
                          isWaitingForSentStatus ||
                          !quoteSendEmailReady
                        }
                        title={
                          !customer?.email
                            ? "Customer has no email address"
                            : !quoteSendEmailReady
                              ? "Configure quote email: Admin → Email → assign a template to “Send quote email”"
                              : undefined
                        }
                      >
                        Send Quote
                      </Button>
                    )}
                    {isWaitingForSentStatus && (
                      <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                        <svg
                          className="animate-spin h-4 w-4 mr-2"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Waiting for status update...
                      </div>
                    )}
                  </>
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
          {fetcher.data &&
            typeof fetcher.data === "object" &&
            "error" in fetcher.data &&
            fetcher.data.error && (
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
                    {"validationErrors" in fetcher.data &&
                      Array.isArray(fetcher.data.validationErrors) &&
                      fetcher.data.validationErrors.length > 0 && (
                        <ul className="mt-2 text-sm text-red-700 dark:text-red-300 list-disc list-inside space-y-1">
                          {(fetcher.data.validationErrors as string[]).map(
                            (error: string, index: number) => (
                              <li key={index}>{error}</li>
                            ),
                          )}
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
                        : quote.status === "Sent"
                          ? "Sent quotes are locked from editing pricing and details. Notes and attachments can still be modified."
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

            <QuoteDeliveryDateCard
              quote={quote}
              variant="summary"
              readOnly={areDetailsLocked}
            />

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
                              { method: "post" },
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
                                { method: "post" },
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
                                : "",
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
                            "expiration-days-input-chip",
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
                              "expiration-days-input-chip",
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
                                    { method: "post" },
                                  );
                                  setEditingExpirationDays(false);
                                }
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
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
                                  { method: "post" },
                                );
                              } else {
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
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
          </div>

          {/* Quote Details Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Quote Details
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6">
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
                    Customer
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCustomerInfoModalOpen(true)}
                    className="mt-1 -mx-2 inline-flex max-w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-blue-900/20"
                  >
                    <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                      {customer?.displayName || "N/A"}
                    </p>
                  </button>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Lead Time
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsLeadTimeModalOpen(true)}
                    disabled={areDetailsLocked}
                    className="mt-1 -mx-2 inline-flex max-w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-blue-900/20 dark:disabled:hover:bg-transparent"
                  >
                    <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                      {quoteLeadTimeDisplay}
                    </p>
                  </button>
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
                  {!areDetailsLocked ? (
                    <div
                      className="inline-flex cursor-pointer rounded px-2 py-1 -mx-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => {
                        setEditingExpirationDays(true);
                        setTimeout(() => {
                          const input = document.getElementById(
                            "expiration-days-input",
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
                              "expiration-days-input",
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
                                    { method: "post" },
                                  );
                                  setEditingExpirationDays(false);
                                }
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
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
                                  { method: "post" },
                                );
                              } else {
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
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
                  {!areDetailsLocked ? (
                    editingVendor ? (
                      <select
                        value={quote.vendorId?.toString() || ""}
                        onChange={(e) => {
                          const vendorId = e.target.value;
                          fetcher.submit(
                            { intent: "updateVendor", vendorId },
                            { method: "post" },
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
                          ),
                        )}
                      </select>
                    ) : (
                      <div
                        onClick={() => setEditingVendor(true)}
                        className="inline-flex max-w-full cursor-pointer rounded px-2 py-1 -mx-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setEditingVendor(true);
                          }
                        }}
                      >
                        <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
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
                {stripeEnabled && quote.stripePaymentLinkUrl && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Payment Link
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            quote.stripePaymentLinkUrl!,
                          );
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        title="Copy payment link"
                      >
                        {copiedLink ? (
                          <svg
                            className="h-3.5 w-3.5 text-green-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-3.5 w-3.5 text-gray-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        )}
                        <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
                      </button>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          quote.stripePaymentLinkActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {quote.stripePaymentLinkActive
                          ? "Active"
                          : "Deactivated"}
                      </span>
                    </div>
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
                    <Link
                      to={`/orders/${convertedOrder.orderNumber}`}
                      className="text-base font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                    >
                      {convertedOrder.orderNumber}
                    </Link>
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
          <LineItemsSection
            items={normalizedLineItems}
            entityType="quote"
            hideThumbnails={hideLineItemThumbnails}
            readOnly={isPricingLocked}
            subtotal={formatCurrency(optimisticTotal)}
            archivedItems={archivedLineItems}
            onAdd={handleAddLineItem}
            onDelete={handleDeleteLineItem}
            onRestoreArchived={handleRestoreArchivedLineItem}
            isRestoringArchived={restoreLineItemFetcher.state !== "idle"}
            restoringArchivedLineItemId={restoringArchivedLineItemId}
            onSaveField={handleSaveLineItemField}
            onSaveAttribute={handleSaveQuotePartAttribute}
            onDrawingUpload={handleQuoteDrawingUpload}
            onDrawingDelete={handleQuoteDrawingDelete}
            partAssetAdminAction={partAssetAdminAction}
            onView3DModel={(part: NormalizedPart) => {
              handleView3DModel({
                id: part.id,
                partName: part.partName || "Part",
                signedMeshUrl: part.modelUrl,
                signedFileUrl: part.solidModelUrl,
                signedThumbnailUrl: part.thumbnailUrl,
                partFileUrl: part.cadFileUrl,
                conversionStatus: part.conversionStatus,
                meshConversionError: part.meshConversionError,
                usesPlaceholderCad: part.usesPlaceholderCad,
              });
            }}
            onViewDrawing={(
              drawing: NormalizedDrawing,
              quotePartId: string,
            ) => {
              setSelectedDrawing({ drawing, quotePartId });
              setDrawingModalOpen(true);
            }}
            rowExtraActions={(item: NormalizedLineItem) => {
              const reportHref =
                item.part && canAccessToolpath
                  ? getToolpathReportHrefForUi({
                      toolpathReportUrl: item.part.toolpathReportUrl,
                    })
                  : null;

              return (
              <>
                {reportHref ? (
                  <a
                    href={reportHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open Toolpath Report"
                    className="p-2 rounded transition-colors duration-150 hover:bg-[#c5e3d1]/50 dark:hover:bg-[#c5e3d1]/10"
                  >
                    <ToolpathIcon className="w-[18px] h-[18px]" />
                  </a>
                ) : null}
                {item.part && canAccessPriceCalculator ? (
                  <IconButton
                    icon={
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
                    }
                    title="Price Calculator"
                    onClick={() => handleOpenCalculatorForPart(item.part!.id)}
                  />
                ) : null}
                {!item.part && !isPricingLocked ? (
                  <IconButton
                    icon={
                      <FilePlusCorner
                        className="w-[18px] h-[18px]"
                        strokeWidth={2}
                      />
                    }
                    title="Add part files"
                    onClick={() =>
                      setPromoteLineItemTarget({
                        id: item.id,
                        name: item.name || "Line item",
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        totalPrice: item.totalPrice,
                        description: item.description,
                        notes: item.notes,
                      })
                    }
                  />
                ) : null}
              </>
              );
            }}
          />

          <AttachmentsSection
            attachments={attachments || []}
            entityType="quote"
            entityId={quote.id}
            readOnly={areAttachmentsLocked}
          />

          {/* Notes and Event Log Section - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Notes */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Quote Notes
                </h3>
                {!isAddingNote && !areNotesLocked && (
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
                  readOnly={areNotesLocked}
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

      {selectedDrawing && (
        <FileViewerModal
          isOpen={drawingModalOpen}
          onClose={() => {
            setDrawingModalOpen(false);
            setSelectedDrawing(null);
          }}
          fileUrl={selectedDrawing.drawing.signedUrl}
          fileName={selectedDrawing.drawing.fileName}
          contentType={selectedDrawing.drawing.contentType || undefined}
          fileSize={selectedDrawing.drawing.fileSize || undefined}
          onDelete={
            isPricingLocked
              ? undefined
              : () =>
                  handleQuoteDrawingDelete(
                    selectedDrawing.drawing.id,
                    selectedDrawing.quotePartId,
                  )
          }
          isDeleting={fetcher.state === "submitting"}
          partAssetAdmin={
            partAssetAdminAction
              ? {
                  action: partAssetAdminAction,
                  context: {
                    surface: "drawing",
                    entity: "quote_part",
                    parentPartId: selectedDrawing.quotePartId,
                    drawingId: selectedDrawing.drawing.id,
                    fileName: selectedDrawing.drawing.fileName,
                  },
                }
              : undefined
          }
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
          quotePartId={selectedPart3D.quotePartId}
          onThumbnailUpdate={() => {
            revalidator.revalidate();
          }}
          autoGenerateThumbnail={true}
          existingThumbnailUrl={selectedPart3D.thumbnailUrl}
          isQuotePart={true}
          cadFileUrl={selectedPart3D.cadFileUrl}
          partAssetAdminAction={partAssetAdminAction}
          meshConversionStatus={selectedPart3D.conversionStatus}
          meshConversionError={selectedPart3D.meshConversionError}
          usesPlaceholderCad={selectedPart3D.usesPlaceholderCad}
          canRevise={canRevise}
          onRevisionComplete={() => {
            setPart3DModalOpen(false);
            setSelectedPart3D(null);
            revalidator.revalidate();
          }}
          onRegenerateMesh={
            selectedPart3D.quotePartId && !selectedPart3D.usesPlaceholderCad
              ? () => {
                  const fd = new FormData();
                  fd.append("intent", "regenerateMesh");
                  fd.append("partId", selectedPart3D.quotePartId!);
                  fetcher.submit(fd, { method: "post" });
                  setPart3DModalOpen(false);
                  setSelectedPart3D(null);
                  revalidator.revalidate();
                }
              : undefined
          }
          bananaEnabled={bananaEnabled}
          bananaModelUrl={bananaModelUrl || undefined}
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
        },
      )}

      {/* Add Line Item Modal */}
      <AddLineItemModal
        isOpen={isAddLineItemModalOpen || promoteLineItemTarget != null}
        onClose={() => {
          setIsAddLineItemModalOpen(false);
          setPromoteLineItemTarget(null);
        }}
        onSubmit={
          promoteLineItemTarget != null
            ? handlePromoteLineItemSubmit
            : handleAddLineItemSubmit
        }
        context="quote"
        positiveSubtotalForDiscount={quotePositiveSubForAddLineModal}
        customerId={quote.customerId}
        promoteLineItemId={promoteLineItemTarget?.id ?? null}
        initialLineItemName={promoteLineItemTarget?.name ?? null}
        prefillFromLineItem={
          promoteLineItemTarget
            ? {
                quantity: promoteLineItemTarget.quantity,
                unitPrice: promoteLineItemTarget.unitPrice,
                totalPrice: promoteLineItemTarget.totalPrice,
                description: promoteLineItemTarget.description,
                notes: promoteLineItemTarget.notes,
              }
            : null
        }
      />

      {canAccessToolpath && (
        <ToolpathUploadModal
          isOpen={isToolpathModalOpen}
          onClose={() => setIsToolpathModalOpen(false)}
          parts={toolpathUploadableParts}
          onUpload={handleToolpathUpload}
          isUploading={toolpathFetcher.state !== "idle"}
          queuedCount={
            toolpathResultsSession === toolpathModalSession
              ? toolpathFetcher.data?.queuedCount
              : undefined
          }
          uploadError={
            toolpathResultsSession === toolpathModalSession
              ? (toolpathFetcher.data?.error ?? null)
              : null
          }
          uploadResults={
            toolpathResultsSession === toolpathModalSession
              ? (toolpathFetcher.data?.results ?? [])
              : []
          }
        />
      )}

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
          isSaving={calculatorFetcher.state !== "idle"}
          mode={calculatorMode}
        />
      )}

      {/* Send Email Modal */}
      {outboundEmailEnabled && isSendEmailModalOpen && (
        <SendQuoteEmailModal
          isOpen={isSendEmailModalOpen}
          onClose={() => setSendEmailModalOpen(false)}
          onSendSuccess={({ delivery }) => {
            if (delivery === "queued") {
              setIsWaitingForSentStatus(true);
            }
          }}
          quote={quote}
          customer={customer}
          attachments={attachments}
          defaultSubject={quoteSendEmailDefaultSubject ?? undefined}
          editableSlots={quoteSendEditableSlots}
          requiredAttachmentDocumentKinds={
            quoteSendRequiredAttachmentDocumentKinds
          }
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

      <ReceivePoModal
        isOpen={isReceivePoModalOpen}
        onClose={() => setIsReceivePoModalOpen(false)}
        fetcher={receivePoFetcher}
      />

      <Modal
        isOpen={isCustomerInfoModalOpen}
        onClose={() => setIsCustomerInfoModalOpen(false)}
        title="Customer"
        size="md"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Name</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                {customer?.displayName || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Business Name
              </p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                {customer?.companyName || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100 break-words">
                {customer?.email || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Phone</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                {customer?.phone || "N/A"}
              </p>
            </div>
          </div>

          {!areDetailsLocked && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
              <label
                htmlFor="quote-customer-account"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Change Customer
              </label>
              <select
                id="quote-customer-account"
                value={quote.customerId?.toString() || ""}
                onChange={(e) => {
                  const customerId = e.target.value;
                  if (
                    !customerId ||
                    customerId === quote.customerId?.toString()
                  ) {
                    return;
                  }
                  fetcher.submit(
                    { intent: "updateCustomer", customerId },
                    { method: "post" },
                  );
                  setIsCustomerInfoModalOpen(false);
                }}
                className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="" disabled>
                  Select a customer
                </option>
                {customers.map((c: { id: number; displayName: string }) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              onClick={() => setIsCustomerInfoModalOpen(false)}
              variant="secondary"
            >
              Close
            </Button>
            {customer?.id && (
              <Link
                to={`/customers/${customer.id}`}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                View Customer Details
              </Link>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isLeadTimeModalOpen}
        onClose={() => setIsLeadTimeModalOpen(false)}
        title="Set Delivery Window"
        size="2xl"
      >
        <QuoteDeliveryDateCard
          quote={quote}
          variant="modal"
          onCancel={() => setIsLeadTimeModalOpen(false)}
          onSaved={() => setIsLeadTimeModalOpen(false)}
        />
      </Modal>

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
              <span className="font-medium">
                {" "}
                A rejection reason is required.
              </span>
            )}
          </p>
          <div>
            <label
              htmlFor="rejectionReason"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Rejection Reason{" "}
              {rejectionReasonRequired && (
                <span className="text-red-500">*</span>
              )}
              {!rejectionReasonRequired && (
                <span className="text-gray-500 font-normal">(Optional)</span>
              )}
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
            <Button onClick={handleRejectModalClose} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleRejectQuoteConfirm} variant="danger">
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
          {error instanceof Error
            ? error.message
            : "An unexpected error occurred while loading the quote."}
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
