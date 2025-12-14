import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  redirect,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
  getOrderByNumberWithAttachments,
  updateOrder,
  restoreOrder,
  type OrderEventContext,
} from "~/lib/orders";
import { getCustomer } from "~/lib/customers";
import { getVendor, getVendors } from "~/lib/vendors";
import {
  getAttachment,
  createAttachment,
  deleteAttachment,
  linkAttachmentToOrder,
  unlinkAttachmentFromOrder,
  type Attachment,
  type AttachmentEventContext,
} from "~/lib/attachments";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import {
  shouldShowEventsInNav,
  shouldShowVersionInHeader,
  isFeatureEnabled,
  FEATURE_FLAGS,
  canUserUploadCadRevision,
} from "~/lib/featureFlags";
import { getBananaModelUrls } from "~/lib/developerSettings";
import {
  uploadFile,
  generateFileKey,
  deleteFile,
  getDownloadUrl,
} from "~/lib/s3.server";
import { generateDocumentPdf } from "~/lib/pdf-service.server";
import { generatePdfThumbnail, isPdfFile } from "~/lib/pdf-thumbnail.server";
import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { isViewableFile, getFileType, formatFileSize } from "~/lib/file-utils";
import { Notes } from "~/components/shared/Notes";
import OrderActionsDropdown from "~/components/orders/OrderActionsDropdown";
import GeneratePurchaseOrderPdfModal from "~/components/orders/GeneratePurchaseOrderPdfModal";
import GenerateInvoicePdfModal from "~/components/orders/GenerateInvoicePdfModal";
import {
  getNotes,
  createNote,
  updateNote,
  archiveNote,
  type NoteEventContext,
} from "~/lib/notes";
import {
  getLineItemsByOrderId,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  type LineItemWithPart,
  type LineItemEventContext,
} from "~/lib/lineItems";
import {
  getPartsByCustomerId,
  hydratePartThumbnails,
  getPart,
} from "~/lib/parts";
import { createEvent, getEventsForOrder } from "~/lib/events";
import { db } from "~/lib/db";
import { parts, attachments, partDrawings } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import LineItemModal from "~/components/LineItemModal";
import type { OrderLineItem, Vendor } from "~/lib/db/schema";
import React, { useState, useRef, useCallback, useEffect } from "react";
import { Part3DViewerModal } from "~/components/shared/Part3DViewerModal";
import { EventTimeline } from "~/components/EventTimeline";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  const orderNumber = params.orderId; // Note: param name stays the same but now represents orderNumber
  if (!orderNumber) {
    throw new Response("Order number is required", { status: 400 });
  }

  const order = await getOrderByNumberWithAttachments(orderNumber);
  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  // Fetch customer and vendor details
  const customer = order.customerId
    ? await getCustomer(order.customerId)
    : null;
  const vendor = order.vendorId ? await getVendor(order.vendorId) : null;

  // Fetch all vendors for shop assignment
  const vendors = await getVendors();

  // Fetch notes for this order
  const notes = await getNotes("order", order.id.toString());

  // Fetch line items for this order
  const lineItems = await getLineItemsByOrderId(order.id);

  // Hydrate thumbnails AND fetch drawings for line item parts
  for (const item of lineItems) {
    if (item.part) {
      // Hydrate thumbnail (convert S3 keys to signed URLs)
      if (item.part.thumbnailUrl) {
        const [hydratedPart] = await hydratePartThumbnails([item.part]);
        item.part = hydratedPart;
      }

      // Fetch part drawings with signed URLs
      const drawingRecords = await db
        .select({
          drawing: partDrawings,
          attachment: attachments,
        })
        .from(partDrawings)
        .leftJoin(attachments, eq(partDrawings.attachmentId, attachments.id))
        .where(eq(partDrawings.partId, item.part.id));

      // Generate signed URLs for drawings
      const drawings = await Promise.all(
        drawingRecords
          .filter((record) => record.attachment !== null)
          .map(async (record) => {
            const attachment = record.attachment!;
            try {
              const signedUrl = await getDownloadUrl(attachment.s3Key, 3600);

              // Generate thumbnail signed URL if available
              let thumbnailSignedUrl: string | null = null;
              if (attachment.thumbnailS3Key) {
                try {
                  thumbnailSignedUrl = await getDownloadUrl(
                    attachment.thumbnailS3Key,
                    3600
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
              console.error("Error generating signed URL for drawing:", error);
              return null;
            }
          })
      );

      // Attach drawings to part
      (item.part as any).drawings = drawings.filter((d) => d !== null);
    }
  }

  // Fetch parts for the customer if available
  let parts = order.customerId
    ? await getPartsByCustomerId(order.customerId)
    : [];

  // Hydrate thumbnails for customer parts (convert S3 keys to signed URLs)
  parts = await hydratePartThumbnails(parts);

  // Get feature flags and events
  const [
    showEventsLink,
    showVersionInHeader,
    pdfAutoDownload,
    events,
    canRevise,
    bananaEnabled,
  ] = await Promise.all([
    shouldShowEventsInNav(),
    shouldShowVersionInHeader(),
    isFeatureEnabled(FEATURE_FLAGS.PDF_AUTO_DOWNLOAD),
    getEventsForOrder(order.id, 10),
    canUserUploadCadRevision(userDetails?.role),
    isFeatureEnabled(FEATURE_FLAGS.BANANA_FOR_SCALE),
  ]);

  // Get banana model URL if feature is enabled
  let bananaModelUrl: string | null = null;
  if (bananaEnabled) {
    const bananaUrls = await getBananaModelUrls();
    if (bananaUrls.meshUrl && bananaUrls.conversionStatus === "completed") {
      bananaModelUrl = await getDownloadUrl(bananaUrls.meshUrl);
    }
  }

  return withAuthHeaders(
    json({
      order,
      customer,
      vendor,
      vendors,
      notes,
      lineItems,
      parts,
      user,
      userDetails,
      appConfig,
      showEventsLink,
      showVersionInHeader,
      pdfAutoDownload,
      events,
      canRevise,
      bananaEnabled,
      bananaModelUrl,
    }),
    headers
  );
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const orderNumber = params.orderId;
  if (!orderNumber) {
    return json({ error: "Order number is required" }, { status: 400 });
  }

  const order = await getOrderByNumberWithAttachments(orderNumber);
  if (!order) {
    return json({ error: "Order not found" }, { status: 404 });
  }

  // Parse form data once
  let formData: FormData;

  // Handle file uploads and multipart form data
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: MAX_FILE_SIZE,
    });

    formData = await unstable_parseMultipartFormData(request, uploadHandler);

    const intent = formData.get("intent") as string;
    const file = formData.get("file") as File;

    // If there's no file, check if this is an intent that handles files differently
    if (!file) {
      const specialIntents = [
        "generatePurchaseOrder",
        "generateInvoice",
        "addDrawingToPart", // Drawing uploads use drawing_0, drawing_1, etc. fields
      ];
      if (specialIntents.includes(intent)) {
        // These intents handle form data differently, let them fall through
      } else {
        // This is a file upload request but no file was provided
        return json({ error: "No file provided" }, { status: 400 });
      }
    } else {
      // We have a file, process the upload
      if (file.size > MAX_FILE_SIZE) {
        return json({ error: "File size exceeds 10MB limit" }, { status: 400 });
      }

      try {
        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Generate S3 key
        const key = generateFileKey(order.id, file.name);

        // Upload to S3
        const uploadResult = await uploadFile({
          key,
          buffer,
          contentType: file.type || "application/octet-stream",
          fileName: file.name,
        });

        // Create event context for attachment operations
        const eventContext: AttachmentEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

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

        // Link to order
        await linkAttachmentToOrder(order.id, attachment.id, eventContext);

        // Return a redirect to refresh the page
        return redirect(`/orders/${orderNumber}`);
      } catch (error) {
        console.error("Upload error:", error);
        return json({ error: "Failed to upload file" }, { status: 500 });
      }
    }
  } else {
    // Not multipart, parse as regular FormData
    formData = await request.formData();
  }

  // Handle form submissions
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "getNotes": {
        const notes = await getNotes("order", order.id.toString());
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
            entityType: "order",
            entityId: order.id.toString(),
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

        const note = await archiveNote(noteId, noteEventContext);
        return withAuthHeaders(json({ note }), headers);
      }

      case "deleteAttachment": {
        const attachmentId = formData.get("attachmentId") as string;

        if (!attachmentId) {
          return json({ error: "Missing attachment ID" }, { status: 400 });
        }

        // Get attachment details
        const attachment = await getAttachment(attachmentId);
        if (!attachment) {
          return json({ error: "Attachment not found" }, { status: 404 });
        }

        const eventContext: AttachmentEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        // Unlink from order first
        await unlinkAttachmentFromOrder(order.id, attachmentId, eventContext);

        // Delete from S3
        await deleteFile(attachment.s3Key);

        // Delete database record
        await deleteAttachment(attachmentId, eventContext);

        // Return a redirect to refresh the page
        return redirect(`/orders/${orderNumber}`);
      }

      case "downloadAttachment": {
        const attachmentId = formData.get("attachmentId") as string;

        if (!attachmentId) {
          return json({ error: "Missing attachment ID" }, { status: 400 });
        }

        const attachment = await getAttachment(attachmentId);
        if (!attachment) {
          return json({ error: "Attachment not found" }, { status: 404 });
        }

        // Generate a presigned URL for download
        const downloadUrl = await getDownloadUrl(attachment.s3Key);

        // Return the URL for client-side redirect
        return json({ downloadUrl });
      }

      case "createLineItem": {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const quantity = parseInt(formData.get("quantity") as string);
        const unitPrice = formData.get("unitPrice") as string;
        const notes = formData.get("notes") as string;
        const partId = formData.get("partId") as string | null;

        if (!name || !quantity || !unitPrice) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const eventContext: LineItemEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const lineItem = await createLineItem(
          {
            orderId: order.id,
            name,
            description,
            quantity,
            unitPrice,
            partId: partId || null,
            notes: notes || null,
          },
          eventContext
        );

        return withAuthHeaders(json({ lineItem }), headers);
      }

      case "updateLineItem": {
        const lineItemId = parseInt(formData.get("lineItemId") as string);
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const quantity = parseInt(formData.get("quantity") as string);
        const unitPrice = formData.get("unitPrice") as string;
        const notes = formData.get("notes") as string;
        const partId = formData.get("partId") as string | null;

        if (!lineItemId || !name || !quantity || !unitPrice) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const eventContext: LineItemEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const lineItem = await updateLineItem(
          lineItemId,
          {
            name,
            description,
            quantity,
            unitPrice,
            partId: partId || null,
            notes: notes || null,
          },
          eventContext
        );

        return withAuthHeaders(json({ lineItem }), headers);
      }

      case "deleteLineItem": {
        const lineItemId = parseInt(formData.get("lineItemId") as string);

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        const eventContext: LineItemEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await deleteLineItem(lineItemId, eventContext);
        return withAuthHeaders(json({ success: true }), headers);
      }

      case "updateLineItemNote": {
        const lineItemId = parseInt(formData.get("lineItemId") as string);
        const notes = formData.get("notes") as string;

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        const eventContext: LineItemEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const lineItem = await updateLineItem(
          lineItemId,
          {
            notes: notes || null,
          },
          eventContext
        );

        return withAuthHeaders(json({ lineItem }), headers);
      }

      case "updateStatus": {
        const status = formData.get("status") as string;

        if (!status) {
          return json({ error: "Missing status" }, { status: 400 });
        }

        const orderEventContext: OrderEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await updateOrder(
          order.id,
          {
            status: status as
              | "Pending"
              | "Waiting_For_Shop_Selection"
              | "In_Production"
              | "In_Inspection"
              | "Shipped"
              | "Delivered"
              | "Completed"
              | "Cancelled"
              | "Archived",
          },
          orderEventContext
        );

        return redirect(`/orders/${orderNumber}`);
      }

      case "assignShop": {
        const vendorId = formData.get("vendorId");

        if (!vendorId) {
          return json({ error: "Please select a vendor" }, { status: 400 });
        }

        const orderEventContext: OrderEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        // Update both vendor and status
        await updateOrder(
          order.id,
          {
            vendorId: parseInt(vendorId as string),
            status: "In_Production",
          },
          orderEventContext
        );

        return redirect(`/orders/${orderNumber}`);
      }

      case "updateOrderInfo": {
        const shipDate = formData.get("shipDate") as string | null;
        const leadTime = formData.get("leadTime") as string | null;
        const vendorPay = formData.get("vendorPay") as string | null;

        const orderEventContext: OrderEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const updates: Partial<{
          shipDate: Date;
          leadTime: number;
          vendorPay: string;
        }> = {};
        if (shipDate) updates.shipDate = new Date(shipDate);
        if (leadTime) updates.leadTime = parseInt(leadTime);
        if (vendorPay) updates.vendorPay = vendorPay;

        await updateOrder(order.id, updates, orderEventContext);

        return redirect(`/orders/${orderNumber}`);
      }

      case "restoreOrder": {
        const orderEventContext: OrderEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await restoreOrder(order.id, orderEventContext);
        return redirect(`/orders/${orderNumber}`);
      }

      case "updatePartAttributes": {
        const partId = formData.get("partId") as string;
        const material = formData.get("material") as string;
        const tolerance = formData.get("tolerance") as string;
        const finishing = formData.get("finishing") as string;

        if (!partId) {
          return json({ error: "Part ID is required" }, { status: 400 });
        }

        // Get current part to compare values
        const currentPart = await getPart(partId);
        if (!currentPart) {
          return json({ error: "Part not found" }, { status: 404 });
        }

        // Normalize values (treat empty string as null)
        const normalizeMaterial = material?.trim() || null;
        const normalizeTolerance = tolerance?.trim() || null;
        const normalizeFinishing = finishing?.trim() || null;

        // Update the part directly in the database (skip generic event from updatePart)
        await db
          .update(parts)
          .set({
            material: normalizeMaterial,
            tolerance: normalizeTolerance,
            finishing: normalizeFinishing,
            updatedAt: new Date(),
          })
          .where(eq(parts.id, partId));

        // Create specific events for each changed attribute
        const eventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        // Material change event (compare normalized values)
        if (normalizeMaterial !== currentPart.material) {
          await createEvent({
            entityType: "part",
            entityId: partId,
            eventType: "part_material_changed",
            eventCategory: "manufacturing",
            title: "Part Material Changed",
            description: `${currentPart.partName || "Part"} changed to ${
              normalizeMaterial || "no material"
            }`,
            metadata: {
              partName: currentPart.partName,
              orderId: order.id,
              orderNumber: order.orderNumber,
              oldValue: currentPart.material,
              newValue: normalizeMaterial,
              field: "material",
            },
            userId: eventContext.userId,
            userEmail: eventContext.userEmail,
          });
        }

        // Tolerance change event (compare normalized values)
        if (normalizeTolerance !== currentPart.tolerance) {
          await createEvent({
            entityType: "part",
            entityId: partId,
            eventType: "part_tolerance_changed",
            eventCategory: "manufacturing",
            title: "Part Tolerance Changed",
            description: `${currentPart.partName || "Part"} changed to ${
              normalizeTolerance || "no tolerance"
            }`,
            metadata: {
              partName: currentPart.partName,
              orderId: order.id,
              orderNumber: order.orderNumber,
              oldValue: currentPart.tolerance,
              newValue: normalizeTolerance,
              field: "tolerance",
            },
            userId: eventContext.userId,
            userEmail: eventContext.userEmail,
          });
        }

        // Finishing change event (compare normalized values)
        if (normalizeFinishing !== currentPart.finishing) {
          await createEvent({
            entityType: "part",
            entityId: partId,
            eventType: "part_finishing_changed",
            eventCategory: "manufacturing",
            title: "Part Finishing Changed",
            description: `${currentPart.partName || "Part"} changed to ${
              normalizeFinishing || "no finishing"
            }`,
            metadata: {
              partName: currentPart.partName,
              orderId: order.id,
              orderNumber: order.orderNumber,
              oldValue: currentPart.finishing,
              newValue: normalizeFinishing,
              field: "finishing",
            },
            userId: eventContext.userId,
            userEmail: eventContext.userEmail,
          });
        }

        return json({ success: true });
      }

      case "updateVendor": {
        const vendorId = formData.get("vendorId") as string | null;

        const orderEventContext: OrderEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        // Update vendor (can be null to remove vendor)
        await updateOrder(
          order.id,
          {
            vendorId: vendorId ? parseInt(vendorId) : null,
          },
          orderEventContext
        );

        return redirect(`/orders/${orderNumber}`);
      }

      case "generatePurchaseOrder": {
        const htmlContent = formData.get("htmlContent") as string;

        if (!htmlContent) {
          return json({ error: "Missing HTML content" }, { status: 400 });
        }

        try {
          const { attachmentId } = await generateDocumentPdf({
            entityType: "order",
            entityId: order.id,
            htmlContent,
            filename: `PO-${order.orderNumber}.pdf`,
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
            filename: `PO-${order.orderNumber}.pdf`,
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
            { status: 500 }
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
            entityType: "order",
            entityId: order.id,
            htmlContent,
            filename: `Invoice-${order.orderNumber}.pdf`,
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
            filename: `Invoice-${order.orderNumber}.pdf`,
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
            { status: 500 }
          );
        }
      }

      case "addDrawingToPart": {
        const partId = formData.get("partId") as string;
        const drawingCount =
          parseInt(formData.get("drawingCount") as string) || 0;

        if (!partId || drawingCount === 0) {
          return json(
            { error: "Missing part ID or drawings" },
            { status: 400 }
          );
        }

        try {
          for (let i = 0; i < drawingCount; i++) {
            const drawing = formData.get(`drawing_${i}`) as File | null;
            if (drawing && drawing.size > 0) {
              // Validate file size (10MB limit)
              if (drawing.size > MAX_FILE_SIZE) {
                return json(
                  {
                    error: `File "${drawing.name}" exceeds 10MB limit (${(
                      drawing.size /
                      1024 /
                      1024
                    ).toFixed(2)}MB)`,
                  },
                  { status: 400 }
                );
              }

              // Convert File to Buffer
              const drawingArrayBuffer = await drawing.arrayBuffer();
              const drawingBuffer = Buffer.from(drawingArrayBuffer);

              // Sanitize filename
              const sanitizedFileName = drawing.name
                .replace(/\s+/g, "-")
                .replace(/[^a-zA-Z0-9._-]/g, "");

              // Upload to S3
              const timestamp = Date.now();
              const drawingKey = `parts/${partId}/drawings/${timestamp}-${i}-${sanitizedFileName}`;
              const uploadResult = await uploadFile({
                key: drawingKey,
                buffer: drawingBuffer,
                contentType: drawing.type || "application/pdf",
                fileName: sanitizedFileName,
              });

              // Generate thumbnail for PDFs
              let thumbnailS3Key: string | null = null;
              if (isPdfFile(drawing.type, drawing.name)) {
                try {
                  const thumbnail = await generatePdfThumbnail(
                    drawingBuffer,
                    200,
                    200
                  );
                  const thumbnailKey = `parts/${partId}/drawings/${timestamp}-${i}-${sanitizedFileName}.thumb.png`;
                  await uploadFile({
                    key: thumbnailKey,
                    buffer: thumbnail.buffer,
                    contentType: "image/png",
                    fileName: `${sanitizedFileName}.thumb.png`,
                  });
                  thumbnailS3Key = thumbnailKey;
                } catch (thumbnailError) {
                  // Log but don't fail the upload if thumbnail generation fails
                  console.error(
                    "Failed to generate PDF thumbnail:",
                    thumbnailError
                  );
                }
              }

              // Create attachment record
              const [attachment] = await db
                .insert(attachments)
                .values({
                  s3Bucket: process.env.S3_BUCKET || "default-bucket",
                  s3Key: uploadResult.key,
                  fileName: drawing.name,
                  contentType: drawing.type || "application/pdf",
                  fileSize: drawing.size,
                  thumbnailS3Key,
                })
                .returning();

              // Link attachment to part
              await db.insert(partDrawings).values({
                partId,
                attachmentId: attachment.id,
                version: 1,
              });
            }
          }

          // Create event for audit trail
          await createEvent({
            entityType: "order",
            entityId: order.id.toString(),
            eventType: "part_drawing_added",
            eventCategory: "system",
            title: "Technical Drawing Added",
            description: `Added ${drawingCount} technical drawing(s) to part`,
            metadata: {
              partId,
              drawingCount,
            },
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          });

          return withAuthHeaders(
            json({ success: true, message: "Drawings uploaded successfully" }),
            headers
          );
        } catch (uploadError) {
          console.error("Error uploading drawings:", uploadError);
          return json({ error: "Failed to upload drawings" }, { status: 500 });
        }
      }

      case "deleteDrawingFromPart": {
        const drawingId = formData.get("drawingId") as string;
        const partId = formData.get("partId") as string;

        if (!drawingId || !partId) {
          return json(
            { error: "Missing drawing ID or part ID" },
            { status: 400 }
          );
        }

        try {
          // First, fetch the attachment to get S3 keys before deleting
          const [attachment] = await db
            .select()
            .from(attachments)
            .where(eq(attachments.id, drawingId));

          if (!attachment) {
            return json({ error: "Drawing not found" }, { status: 404 });
          }

          // Delete the part_drawings link
          await db
            .delete(partDrawings)
            .where(eq(partDrawings.attachmentId, drawingId));

          // Delete the attachment record
          await db.delete(attachments).where(eq(attachments.id, drawingId));

          // Delete S3 files (original and thumbnail)
          try {
            await deleteFile(attachment.s3Key);
            if (attachment.thumbnailS3Key) {
              await deleteFile(attachment.thumbnailS3Key);
            }
          } catch (s3Error) {
            // Log but don't fail - DB records are already deleted
            console.error("Error deleting S3 files:", s3Error);
          }

          // Create event for audit trail
          await createEvent({
            entityType: "order",
            entityId: order.id.toString(),
            eventType: "part_drawing_deleted",
            eventCategory: "system",
            title: "Technical Drawing Deleted",
            description: `Deleted technical drawing from part`,
            metadata: {
              partId,
              drawingId,
              fileName: attachment.fileName,
            },
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          });

          return withAuthHeaders(
            json({ success: true, message: "Drawing deleted successfully" }),
            headers
          );
        } catch (deleteError) {
          console.error("Error deleting drawing:", deleteError);
          return json({ error: "Failed to delete drawing" }, { status: 500 });
        }
      }

      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Notes action error:", error);
    return json({ error: "Failed to process request" }, { status: 500 });
  }
}

export default function OrderDetails() {
  const {
    order,
    customer,
    vendor,
    vendors,
    notes,
    lineItems,
    parts,
    user,
    userDetails,
    appConfig,
    showEventsLink,
    showVersionInHeader,
    pdfAutoDownload,
    events,
    canRevise,
    bananaEnabled,
    bananaModelUrl,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [showNotice, setShowNotice] = useState(true);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    fileName: string;
    contentType?: string;
    fileSize?: number;
    drawingId?: string;
    partId?: string;
  } | null>(null);
  const [lineItemModalOpen, setLineItemModalOpen] = useState(false);
  const [selectedLineItem, setSelectedLineItem] =
    useState<OrderLineItem | null>(null);
  const [lineItemMode, setLineItemMode] = useState<"create" | "edit">("create");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState<string>("");
  const [part3DModalOpen, setPart3DModalOpen] = useState(false);
  const [selectedPart3D, setSelectedPart3D] = useState<{
    partId?: string;
    partName?: string;
    modelUrl?: string;
    solidModelUrl?: string;
    thumbnailUrl?: string;
    cadFileUrl?: string;
  } | null>(null);
  const [assignShopModalOpen, setAssignShopModalOpen] = useState(false);
  const [manageVendorModalOpen, setManageVendorModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [editOrderModalOpen, setEditOrderModalOpen] = useState(false);
  const [editOrderForm, setEditOrderForm] = useState({
    shipDate: "",
    leadTime: "",
    vendorPayDollar: "",
    vendorPayPercent: "",
  });
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const lineItemFetcher = useFetcher();
  const notesFetcher = useFetcher();
  const orderEditFetcher = useFetcher();
  const drawingFetcher = useFetcher();
  const drawingDeleteFetcher = useFetcher();
  const lastDrawingFetcherData = useRef<unknown>(null);
  const lastDrawingDeleteFetcherData = useRef<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [editingAttributeField, setEditingAttributeField] = useState<{
    partId: string;
    field: "material" | "tolerance" | "finishing";
  } | null>(null);
  const [editingAttributeValue, setEditingAttributeValue] =
    useState<string>("");
  const [showPartAttributes, setShowPartAttributes] = useState(false);

  const handleFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);

      uploadFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });

      // Reset the file input
      event.target.value = "";
    }
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (confirm("Are you sure you want to delete this attachment?")) {
      const formData = new FormData();
      formData.append("intent", "deleteAttachment");
      formData.append("attachmentId", attachmentId);

      deleteFetcher.submit(formData, {
        method: "post",
      });
    }
  };

  const handleViewFile = (attachment: {
    id: string;
    fileName: string;
    contentType: string;
    fileSize: number | null;
  }) => {
    const fileUrl = `/attachments/${attachment.id}/download`;
    setSelectedFile({
      url: fileUrl,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      fileSize: attachment.fileSize || undefined,
    });
    setFileModalOpen(true);
  };

  const handleAddLineItem = () => {
    setSelectedLineItem(null);
    setLineItemMode("create");
    setLineItemModalOpen(true);
  };

  const handleEditLineItem = (item: LineItemWithPart) => {
    const lineItem = item.lineItem;
    setSelectedLineItem(lineItem);
    setLineItemMode("edit");
    setLineItemModalOpen(true);
  };

  const handleDeleteLineItem = (lineItemId: number) => {
    if (confirm("Are you sure you want to delete this line item?")) {
      const formData = new FormData();
      formData.append("intent", "deleteLineItem");
      formData.append("lineItemId", lineItemId.toString());

      lineItemFetcher.submit(formData, {
        method: "post",
      });
    }
  };

  const handleDrawingUpload = useCallback(
    (partId: string, files: FileList | null) => {
      if (!files || files.length === 0) return;

      // Validate file sizes (10MB limit per file)
      const MAX_DRAWING_SIZE = 10 * 1024 * 1024; // 10MB
      const invalidFiles = Array.from(files).filter(
        (file) => file.size > MAX_DRAWING_SIZE
      );

      if (invalidFiles.length > 0) {
        alert(
          `The following files exceed the 10MB limit:\n${invalidFiles
            .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`)
            .join("\n")}`
        );
        return;
      }

      const formData = new FormData();
      formData.append("intent", "addDrawingToPart");
      formData.append("partId", partId);

      Array.from(files).forEach((file, index) => {
        formData.append(`drawing_${index}`, file);
      });
      formData.append("drawingCount", files.length.toString());

      drawingFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [drawingFetcher]
  );

  // Watch drawing upload completion and revalidate
  useEffect(() => {
    if (
      drawingFetcher.state === "idle" &&
      drawingFetcher.data &&
      drawingFetcher.data !== lastDrawingFetcherData.current
    ) {
      lastDrawingFetcherData.current = drawingFetcher.data;
      const data = drawingFetcher.data as { success?: boolean; error?: string };
      if (data.success) {
        // Success - revalidate to show new drawings
        revalidator.revalidate();
      } else if (data.error) {
        // Error - show error message
        alert(`Upload failed: ${data.error}`);
      }
    }
  }, [drawingFetcher.state, drawingFetcher.data, revalidator]);

  const handleDeleteDrawing = useCallback(
    (drawingId: string, partId: string) => {
      const formData = new FormData();
      formData.append("intent", "deleteDrawingFromPart");
      formData.append("drawingId", drawingId);
      formData.append("partId", partId);

      drawingDeleteFetcher.submit(formData, {
        method: "post",
      });
    },
    [drawingDeleteFetcher]
  );

  // Watch drawing delete completion and revalidate
  useEffect(() => {
    if (
      drawingDeleteFetcher.state === "idle" &&
      drawingDeleteFetcher.data &&
      drawingDeleteFetcher.data !== lastDrawingDeleteFetcherData.current
    ) {
      lastDrawingDeleteFetcherData.current = drawingDeleteFetcher.data;
      const data = drawingDeleteFetcher.data as {
        success?: boolean;
        error?: string;
      };
      if (data.success) {
        // Success - close modal and revalidate
        setFileModalOpen(false);
        setSelectedFile(null);
        revalidator.revalidate();
      } else if (data.error) {
        // Error - show error message
        alert(`Delete failed: ${data.error}`);
      }
    }
  }, [drawingDeleteFetcher.state, drawingDeleteFetcher.data, revalidator]);

  const handleCloseLineItemModal = useCallback(() => {
    setLineItemModalOpen(false);
  }, []);

  const handleLineItemSubmit = useCallback(
    (data: {
      name: string;
      description: string;
      quantity: number;
      unitPrice: string;
      partId?: string | null;
    }) => {
      const formData = new FormData();
      formData.append(
        "intent",
        lineItemMode === "create" ? "createLineItem" : "updateLineItem"
      );
      formData.append("name", data.name);
      formData.append("description", data.description);
      formData.append("quantity", data.quantity.toString());
      formData.append("unitPrice", data.unitPrice);

      // Include partId if present
      if (data.partId) {
        formData.append("partId", data.partId);
      }

      if (lineItemMode === "edit" && selectedLineItem) {
        formData.append("lineItemId", selectedLineItem.id.toString());
        // Preserve existing notes when editing (they're edited inline, not in the modal)
        formData.append("notes", selectedLineItem.notes || "");
      } else {
        // For new line items, start with empty notes
        formData.append("notes", "");
      }

      lineItemFetcher.submit(formData, {
        method: "post",
      });
    },
    [lineItemMode, selectedLineItem, lineItemFetcher]
  );

  const handleStartEditNote = (
    lineItemId: number,
    currentNote: string | null
  ) => {
    setEditingNoteId(lineItemId);
    setEditingNoteValue(currentNote || "");
  };

  const handleSaveNote = (lineItemId: number) => {
    const formData = new FormData();
    formData.append("intent", "updateLineItemNote");
    formData.append("lineItemId", lineItemId.toString());
    formData.append("notes", editingNoteValue);

    notesFetcher.submit(formData, {
      method: "post",
    });

    setEditingNoteId(null);
    setEditingNoteValue("");
  };

  const handleCancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteValue("");
  };

  const handleStartEditAttribute = (
    partId: string,
    field: "material" | "tolerance" | "finishing",
    currentValue: string | null
  ) => {
    setEditingAttributeField({ partId, field });
    // For tolerance, add ± if empty
    if (field === "tolerance" && !currentValue) {
      setEditingAttributeValue("±");
    } else {
      setEditingAttributeValue(currentValue || "");
    }
  };

  const handleToleranceChange = (value: string) => {
    // Remove ± symbol from the value for processing
    const cleanValue = value.replace(/±/g, "");

    // Check if the clean value contains any non-numeric characters (excluding decimal point, minus, and spaces)
    const hasText = /[^0-9.\-\s]/.test(cleanValue);

    if (hasText) {
      // If it contains text, don't add the ± symbol
      setEditingAttributeValue(cleanValue);
    } else {
      // If it's empty or only contains numbers/decimal/minus/spaces
      if (cleanValue.trim() === "") {
        // If empty, just show the ± symbol
        setEditingAttributeValue("±");
      } else {
        // If it contains numbers, add ± at the beginning
        setEditingAttributeValue("±" + cleanValue);
      }
    }
  };

  const handleSaveAttribute = (
    partId: string,
    field: "material" | "tolerance" | "finishing"
  ) => {
    const formData = new FormData();
    formData.append("intent", "updatePartAttributes");
    formData.append("partId", partId);
    formData.append(field, editingAttributeValue);

    // Preserve other fields
    const part = lineItems.find(
      (item: LineItemWithPart) => item.part?.id === partId
    )?.part;
    if (part) {
      if (field !== "material")
        formData.append("material", part.material || "");
      if (field !== "tolerance")
        formData.append("tolerance", part.tolerance || "");
      if (field !== "finishing")
        formData.append("finishing", part.finishing || "");
    }

    notesFetcher.submit(formData, {
      method: "post",
    });

    setEditingAttributeField(null);
    setEditingAttributeValue("");
  };

  const handleCancelEditAttribute = () => {
    setEditingAttributeField(null);
    setEditingAttributeValue("");
  };

  const handleView3DModel = (part: {
    id: string;
    partName: string | null;
    partMeshUrl?: string | null;
    partFileUrl?: string | null;
    thumbnailUrl?: string | null;
  }) => {
    if (part) {
      setSelectedPart3D({
        partId: part.id,
        partName: part.partName || undefined,
        modelUrl: part.partMeshUrl || undefined,
        solidModelUrl: part.partFileUrl || undefined,
        thumbnailUrl: part.thumbnailUrl || undefined,
        // partFileUrl is the original CAD file used for revisions
        cadFileUrl: part.partFileUrl || undefined,
      });
      setPart3DModalOpen(true);
    }
  };

  // Status transition handlers
  const handleSendToShops = () => {
    if (
      confirm(
        "Are you sure you want to send this order to shops? The order will move to 'Waiting for Shop Selection' status."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "Waiting_For_Shop_Selection");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleStartProduction = () => {
    if (
      confirm(
        "Are you sure you want to start production? The order will move to 'In Production' status."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "In_Production");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleAssignShop = () => {
    setSelectedVendorId(order.vendorId);
    setAssignShopModalOpen(true);
  };

  const handleAssignShopSubmit = () => {
    if (!selectedVendorId) {
      alert("Please select a vendor");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "assignShop");
    formData.append("vendorId", selectedVendorId.toString());
    lineItemFetcher.submit(formData, { method: "post" });
    setAssignShopModalOpen(false);
  };

  const handleManageVendor = () => {
    setSelectedVendorId(order.vendorId);
    setManageVendorModalOpen(true);
  };

  const handleManageVendorSubmit = () => {
    const formData = new FormData();
    formData.append("intent", "updateVendor");
    if (selectedVendorId) {
      formData.append("vendorId", selectedVendorId.toString());
    }
    lineItemFetcher.submit(formData, { method: "post" });
    setManageVendorModalOpen(false);
  };

  const handleRemoveVendor = () => {
    if (
      confirm("Are you sure you want to remove the vendor from this order?")
    ) {
      const formData = new FormData();
      formData.append("intent", "updateVendor");
      lineItemFetcher.submit(formData, { method: "post" });
      setManageVendorModalOpen(false);
    }
  };

  const handleStartInspection = () => {
    if (
      confirm(
        "Are you sure you want to start inspection? The order will move to 'In Inspection' status."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "In_Inspection");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleShipOrder = () => {
    if (confirm("Are you sure you want to mark this order as shipped?")) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "Shipped");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleMarkAsDelivered = () => {
    if (confirm("Are you sure you want to mark this order as delivered?")) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "Delivered");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleCompleteOrder = () => {
    if (
      confirm(
        "Are you sure you want to complete this order? The order will be marked as 'Completed'."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "Completed");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleEditOrder = () => {
    // Initialize with the existing vendor pay dollar amount
    const vendorPayAmount = Math.max(0, parseFloat(order.vendorPay || "0"));
    const orderTotal = Math.max(0, parseFloat(order.totalPrice || "0"));
    const vendorPayPercentCalc =
      orderTotal > 0 ? Math.min(100, (vendorPayAmount / orderTotal) * 100) : 70;

    setEditOrderForm({
      shipDate: order.shipDate
        ? new Date(order.shipDate).toISOString().split("T")[0]
        : "",
      leadTime: order.leadTime?.toString() || "",
      vendorPayDollar: vendorPayAmount > 0 ? vendorPayAmount.toFixed(2) : "",
      vendorPayPercent:
        vendorPayPercentCalc > 0 ? vendorPayPercentCalc.toFixed(1) : "",
    });
    setEditOrderModalOpen(true);
  };

  const handleEditOrderSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "updateOrderInfo");

    if (editOrderForm.shipDate) {
      formData.append("shipDate", editOrderForm.shipDate);
    }

    if (editOrderForm.leadTime) {
      const leadTime = parseInt(editOrderForm.leadTime);
      if (!isNaN(leadTime) && leadTime >= 0) {
        formData.append("leadTime", leadTime.toString());
      }
    }

    // Validate and submit vendor pay
    const vendorPayDollar = parseFloat(editOrderForm.vendorPayDollar || "0");
    if (!isNaN(vendorPayDollar) && vendorPayDollar >= 0) {
      formData.append("vendorPay", vendorPayDollar.toFixed(2));
    } else {
      // Default to 0 if invalid
      formData.append("vendorPay", "0.00");
    }

    orderEditFetcher.submit(formData, { method: "post" });
    setEditOrderModalOpen(false);
  }, [editOrderForm, orderEditFetcher]);

  // Handle keyboard shortcuts for edit order modal
  useEffect(() => {
    if (!editOrderModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditOrderModalOpen(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleEditOrderSubmit();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editOrderModalOpen, handleEditOrderSubmit]);

  const handleGenerateInvoice = () => {
    setIsInvoiceModalOpen(true);
  };

  const handleGeneratePO = () => {
    setIsPOModalOpen(true);
  };

  // Calculate days until ship date
  const shipDate = order.shipDate ? new Date(order.shipDate) : null;
  const today = new Date();
  const daysUntilShip = shipDate
    ? Math.ceil((shipDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Determine priority based on days until ship
  const getPriority = () => {
    if (!daysUntilShip) return "Normal";
    if (daysUntilShip <= 3) return "Critical";
    if (daysUntilShip <= 7) return "High";
    return "Normal";
  };

  const priority = getPriority();

  // Format currency
  const formatCurrency = (amount: string | null) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
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

  // Use the stored total price from the database (maintained by line item operations)
  const orderTotalPrice = order.totalPrice || "0";

  // For debugging: calculate from line items to verify stored total is correct
  // const calculatedFromLineItems = lineItems
  //   .reduce((sum: number, item: LineItemWithPart) => {
  //     const quantity = item.lineItem?.quantity || 0;
  //     const unitPrice = parseFloat(item.lineItem?.unitPrice || "0");
  //     return sum + quantity * unitPrice;
  //   }, 0)
  //   .toString();

  // Vendor pay is now stored as a dollar amount
  const vendorPayAmount = parseFloat(order.vendorPay || "0");

  // Calculate the percentage for display purposes
  const vendorPayPercentage =
    parseFloat(orderTotalPrice) > 0
      ? (vendorPayAmount / parseFloat(orderTotalPrice)) * 100
      : 0;

  // Get status display
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "Waiting_For_Shop_Selection":
        return "Waiting for Shop Selection";
      case "In_Production":
        return "In Production";
      case "In_Inspection":
        return "In Inspection";
      case "Shipped":
        return "Shipped";
      case "Delivered":
        return "Delivered";
      case "Archived":
        return "Archived";
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  // Get status color classes
  const getStatusClasses = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
      case "waiting_for_shop_selection":
        return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
      case "in_production":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
      case "in_inspection":
        return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
      case "shipped":
        return "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300";
      case "delivered":
        return "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400";
      case "completed":
        return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
      case "cancelled":
        return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
      case "archived":
        return "bg-gray-900 text-gray-100 dark:bg-gray-950 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
    }
  };

  // Get priority color classes
  const getPriorityClasses = (priority: string) => {
    switch (priority) {
      case "Critical":
        return "bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100";
      case "High":
        return "bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100";
      default:
        return "bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100";
    }
  };

  // Calculate progress based on order status
  const getOrderProgress = (status: string): number => {
    const statusProgress: Record<string, number> = {
      Pending: 10,
      Waiting_For_Shop_Selection: 20,
      In_Production: 50,
      In_Inspection: 75,
      Shipped: 90,
      Delivered: 95,
      Completed: 100,
      Cancelled: 0,
      Archived: 100,
    };
    return statusProgress[status] ?? 0;
  };

  const progress = getOrderProgress(order.status);

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
              { label: "Orders", href: "/orders" },
              { label: order.orderNumber },
            ]}
          />
          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <Button
                ref={actionsButtonRef}
                onClick={() => setIsActionsDropdownOpen(!isActionsDropdownOpen)}
                variant="secondary"
              >
                Actions
              </Button>
              <OrderActionsDropdown
                isOpen={isActionsDropdownOpen}
                onClose={() => setIsActionsDropdownOpen(false)}
                excludeRef={actionsButtonRef}
                onGenerateInvoice={handleGenerateInvoice}
                onGeneratePO={handleGeneratePO}
                onManageVendor={handleManageVendor}
                hasVendor={!!order.vendorId}
                hasCustomer={!!order.customerId}
              />
            </div>
            {order.status === "Pending" &&
              (order.vendorId ? (
                <Button
                  onClick={handleStartProduction}
                  variant="primary"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Start Production
                </Button>
              ) : (
                <Button
                  onClick={handleSendToShops}
                  variant="primary"
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  Send to Board
                </Button>
              ))}
            {order.status === "Waiting_For_Shop_Selection" && (
              <Button
                onClick={handleAssignShop}
                variant="primary"
                className="bg-blue-600 hover:bg-blue-700"
              >
                Assign Shop
              </Button>
            )}
            {order.status === "In_Production" && (
              <Button
                onClick={handleStartInspection}
                variant="primary"
                className="bg-amber-600 hover:bg-amber-700"
              >
                Start Inspection
              </Button>
            )}
            {order.status === "In_Inspection" && (
              <Button
                onClick={handleShipOrder}
                variant="primary"
                className="bg-teal-600 hover:bg-teal-700"
              >
                Ship Order
              </Button>
            )}
            {order.status === "Shipped" && (
              <Button
                onClick={handleMarkAsDelivered}
                variant="primary"
                className="bg-green-600 hover:bg-green-700"
              >
                Mark as Delivered
              </Button>
            )}
            {order.status === "Delivered" && (
              <Button
                onClick={handleCompleteOrder}
                variant="primary"
                className="bg-green-700 hover:bg-green-800"
              >
                Complete Order
              </Button>
            )}
            {/* No action buttons for archived orders - restore button is in the banner */}
          </div>
        </div>

        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">
          {/* Archived Notice Bar */}
          {order.status === "Archived" && (
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
                    This order has been archived
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Notice Bar */}
          {showNotice &&
            daysUntilShip &&
            daysUntilShip <= 7 &&
            order.status !== "Archived" && (
              <div className="relative bg-yellow-100 dark:bg-yellow-900/50 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
                <button
                  onClick={() => setShowNotice(false)}
                  className="absolute top-2 right-2 text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
                <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                  Attention: This order is approaching its due date (
                  {daysUntilShip} days remaining)
                </p>
              </div>
            )}

          {/* Status Cards - Always at top */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Order Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Order Status
              </h3>
              <div
                className={`px-4 py-3 rounded-full text-center font-semibold ${getStatusClasses(
                  order.status
                )}`}
              >
                {getStatusDisplay(order.status)}
              </div>
            </div>

            {/* Priority Level Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Priority Level
              </h3>
              <div
                className={`px-4 py-3 rounded-full text-center font-semibold ${getPriorityClasses(
                  priority
                )}`}
              >
                {priority} Priority
              </div>
            </div>

            {/* Order Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Order Value
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(orderTotalPrice)}
              </p>
            </div>

            {/* Progress Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Progress
              </h3>
              <div className="relative w-full h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-green-500 dark:bg-green-600 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                  {progress}%
                </span>
              </div>
            </div>
          </div>

          {/* Information Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Order Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Order Information
                </h3>
                <button
                  onClick={handleEditOrder}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                >
                  Edit
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                    />
                  </svg>
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Order Number
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {order.orderNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Order Date
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Ship Date
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatDate(order.shipDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Lead Time
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {order.leadTime ? `${order.leadTime} Days` : "--"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Vendor Pay
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatCurrency(vendorPayAmount.toString())} (
                      {vendorPayPercentage.toFixed(1)}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Profit Margin
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatCurrency(
                        (
                          parseFloat(orderTotalPrice) - vendorPayAmount
                        ).toString()
                      )}{" "}
                      ({(100 - vendorPayPercentage).toFixed(1)}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Customer Information
                </h3>
                {customer && (
                  <a
                    href={`/customers/${customer.id}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                  >
                    View Customer
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                      />
                    </svg>
                  </a>
                )}
              </div>
              <div className="p-6">
                {customer ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Company
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {customer.displayName}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Customer ID
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        CUST-{customer.id.toString().padStart(5, "0")}
                      </p>
                    </div>
                    {customer.email && (
                      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4">
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Primary Contact
                        </p>
                        <p className="text-gray-900 dark:text-gray-100">
                          {customer.email}
                        </p>
                        {customer.phone && (
                          <p className="text-gray-900 dark:text-gray-100">
                            {customer.phone}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">
                    No customer information available
                  </p>
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
              <div className="flex items-center gap-3">
                <style>{`
                  .specs-icon path {
                    transition: transform 0.3s ease-in-out;
                  }

                  .specs-icon.open .layer-top {
                    transform: translateY(-2px);
                  }

                  .specs-icon.open .layer-middle {
                    transform: translateY(0px);
                  }

                  .specs-icon.open .layer-bottom {
                    transform: translateY(2px);
                  }

                  .specs-icon.closed .layer-top {
                    transform: translateY(0);
                  }

                  .specs-icon.closed .layer-middle {
                    transform: translateY(0);
                  }

                  .specs-icon.closed .layer-bottom {
                    transform: translateY(0);
                  }
                `}</style>
                <button
                  onClick={() => setShowPartAttributes(!showPartAttributes)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    showPartAttributes
                      ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                      : "bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-500"
                  }`}
                  title={
                    showPartAttributes
                      ? "Hide part specifications"
                      : "Show part specifications"
                  }
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                    className={`specs-icon ${
                      showPartAttributes ? "open" : "closed"
                    }`}
                  >
                    {/* Top layer */}
                    <path
                      className="layer-top"
                      d="M8.235 1.559a.5.5 0 0 0-.47 0l-7.5 4a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882l-7.5-4zM8 9.433 1.562 6 8 2.567 14.438 6 8 9.433z"
                    />
                    {/* Middle layer */}
                    <path
                      className="layer-middle"
                      d="M3.188 8 .264 9.559a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882L12.813 8l-4.578 2.441a.5.5 0 0 1-.47 0L3.188 8z"
                      style={{ opacity: 0.7 }}
                    />
                    {/* Bottom layer */}
                    <path
                      className="layer-bottom"
                      d="M11.75 8.567l3.688 1.966L8 13.433l-6.438-2.9L4.25 8.567l3.515 1.874a.5.5 0 0 0 .47 0l3.515-1.874z"
                      style={{ opacity: 0.5 }}
                    />
                  </svg>
                  Specs
                </button>
                <Button size="sm" onClick={handleAddLineItem}>
                  Add Line Item
                </Button>
              </div>
            </div>
            <div className="p-6">
              {lineItems && lineItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[25%]">
                          Item
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[20%]">
                          Description
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[25%]">
                          Notes
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[8%]">
                          Quantity
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[10%]">
                          Unit Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[10%]">
                          Total
                        </th>
                        <th className="px-6 py-3 w-[7%]"></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {lineItems.map((item: LineItemWithPart) => {
                        const lineItem = item.lineItem;
                        const part = item.part;
                        const total =
                          (lineItem?.quantity || 0) *
                          parseFloat(lineItem?.unitPrice || "0");
                        const isEditingNote = editingNoteId === lineItem?.id;
                        return (
                          <React.Fragment key={lineItem?.id}>
                            {/* Main row */}
                            <tr>
                              <td
                                className="px-6 py-4"
                                rowSpan={showPartAttributes && part ? 2 : 1}
                                style={
                                  showPartAttributes && part
                                    ? { height: "120px" }
                                    : undefined
                                }
                              >
                                <div className="flex items-start gap-3 h-full">
                                  {/* 3D Model Thumbnail */}
                                  {part ? (
                                    part.thumbnailUrl ? (
                                      <button
                                        onClick={() => handleView3DModel(part)}
                                        className={`${
                                          showPartAttributes
                                            ? "h-20 w-20"
                                            : "h-10 w-10"
                                        } p-0 border-2 border-gray-300 dark:border-blue-500 bg-white dark:bg-gray-800 rounded-lg cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all flex-shrink-0`}
                                        title="Click to view 3D model"
                                        type="button"
                                      >
                                        <img
                                          src={part.thumbnailUrl}
                                          alt={`${
                                            part.partName ||
                                            lineItem?.name ||
                                            ""
                                          } thumbnail`}
                                          className="h-full w-full object-cover rounded-lg hover:opacity-90 transition-opacity"
                                        />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleView3DModel(part)}
                                        className={`${
                                          showPartAttributes
                                            ? "h-20 w-20"
                                            : "h-10 w-10"
                                        } bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors border-0 p-0`}
                                        title="Click to view 3D model"
                                        type="button"
                                      >
                                        <svg
                                          className={`${
                                            showPartAttributes
                                              ? "h-6 w-6"
                                              : "h-5 w-5"
                                          } text-gray-400 dark:text-gray-500`}
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                          />
                                        </svg>
                                      </button>
                                    )
                                  ) : null}

                                  {/* Technical Drawing Thumbnail */}
                                  {part &&
                                  part.drawings &&
                                  part.drawings.length > 0 ? (
                                    <button
                                      onClick={() => {
                                        const drawing = part.drawings![0];
                                        setSelectedFile({
                                          url: drawing.signedUrl,
                                          fileName: drawing.fileName,
                                          contentType:
                                            drawing.contentType || undefined,
                                          fileSize:
                                            drawing.fileSize || undefined,
                                          drawingId: drawing.id,
                                          partId: part.id,
                                        });
                                        setFileModalOpen(true);
                                      }}
                                      className={`relative ${
                                        showPartAttributes
                                          ? "h-20 w-20"
                                          : "h-10 w-10"
                                      } border-2 border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden hover:border-blue-500 transition-colors bg-white dark:bg-gray-700 flex items-center justify-center flex-shrink-0`}
                                      title="Click to view technical drawing"
                                      type="button"
                                    >
                                      {/* Show thumbnail: image files use signedUrl, PDFs use thumbnailSignedUrl if available */}
                                      {part.drawings[0].contentType?.startsWith(
                                        "image/"
                                      ) ? (
                                        <img
                                          src={part.drawings[0].signedUrl}
                                          alt="Technical drawing"
                                          className="w-full h-full object-cover"
                                        />
                                      ) : part.drawings[0]
                                          .thumbnailSignedUrl ? (
                                        <img
                                          src={
                                            part.drawings[0].thumbnailSignedUrl
                                          }
                                          alt="Technical drawing thumbnail"
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex flex-col items-center justify-center text-red-500">
                                          <svg
                                            className={`${
                                              showPartAttributes
                                                ? "w-6 h-6"
                                                : "w-4 h-4"
                                            }`}
                                            fill="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                                            <path
                                              d="M14 2v6h6"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="1"
                                            />
                                          </svg>
                                          {showPartAttributes && (
                                            <span className="text-xs font-bold mt-0.5">
                                              PDF
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {/* Count badge */}
                                      {part.drawings.length > 1 && (
                                        <div className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold shadow-sm">
                                          {part.drawings.length}
                                        </div>
                                      )}
                                    </button>
                                  ) : part ? (
                                    /* Upload button or loading spinner when no drawings */
                                    drawingFetcher.state === "submitting" ? (
                                      <div
                                        className={`${
                                          showPartAttributes
                                            ? "h-20 w-20"
                                            : "h-10 w-10"
                                        } border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0`}
                                      >
                                        <div
                                          className={`animate-spin rounded-full ${
                                            showPartAttributes
                                              ? "h-6 w-6"
                                              : "h-4 w-4"
                                          } border-b-2 border-blue-600`}
                                        ></div>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          const input =
                                            document.createElement("input");
                                          input.type = "file";
                                          input.accept =
                                            ".pdf,.png,.jpg,.jpeg,.dwg,.dxf";
                                          input.multiple = true;
                                          input.onchange = (e) =>
                                            handleDrawingUpload(
                                              part.id,
                                              (e.target as HTMLInputElement)
                                                .files
                                            );
                                          input.click();
                                        }}
                                        className={`${
                                          showPartAttributes
                                            ? "h-20 w-20"
                                            : "h-10 w-10"
                                        } border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 transition-colors bg-gray-50 dark:bg-gray-800 flex flex-col items-center justify-center group flex-shrink-0`}
                                        title="Upload technical drawing"
                                        type="button"
                                      >
                                        <svg
                                          className={`${
                                            showPartAttributes
                                              ? "w-5 h-5"
                                              : "w-4 h-4"
                                          } text-gray-400 group-hover:text-blue-500`}
                                          fill="none"
                                          viewBox="0 0 24 24"
                                          stroke="currentColor"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                          />
                                        </svg>
                                        {showPartAttributes && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400 group-hover:text-blue-500 mt-0.5">
                                            Drawing
                                          </span>
                                        )}
                                      </button>
                                    )
                                  ) : null}

                                  {/* Part name and info */}
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                      {lineItem?.name || "--"}
                                    </span>
                                    {part && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        Part: {part.partName}
                                      </span>
                                    )}
                                    {/* Show drawing count if multiple when NOT in specs mode */}
                                    {!showPartAttributes &&
                                      part?.drawings &&
                                      part.drawings.length > 1 && (
                                        <span className="text-xs text-blue-600 dark:text-blue-400">
                                          {part.drawings.length} drawings
                                        </span>
                                      )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                {lineItem?.description || "--"}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 w-[25%] max-w-[25%]">
                                {isEditingNote ? (
                                  <div className="flex items-center space-x-2">
                                    <textarea
                                      value={editingNoteValue}
                                      onChange={(e) =>
                                        setEditingNoteValue(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                          e.preventDefault();
                                          handleSaveNote(lineItem?.id || 0);
                                        } else if (e.key === "Escape") {
                                          handleCancelEditNote();
                                        }
                                      }}
                                      className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                      placeholder="Add note... (Shift+Enter for new line)"
                                      rows={2}
                                    />
                                    <button
                                      onClick={() =>
                                        handleSaveNote(lineItem?.id || 0)
                                      }
                                      className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                                      title="Save (Enter)"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
                                        fill="currentColor"
                                        viewBox="0 0 16 16"
                                      >
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={handleCancelEditNote}
                                      className="p-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                      title="Cancel (Esc)"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
                                        fill="currentColor"
                                        viewBox="0 0 16 16"
                                      >
                                        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                      </svg>
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleStartEditNote(
                                        lineItem?.id || 0,
                                        lineItem?.notes || ""
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        handleStartEditNote(
                                          lineItem?.id || 0,
                                          lineItem?.notes || ""
                                        );
                                      }
                                    }}
                                    className="cursor-pointer min-h-[28px] px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left w-full"
                                    title="Click to edit note"
                                  >
                                    {lineItem?.notes ? (
                                      <span className="text-sm break-words whitespace-pre-wrap">
                                        {lineItem?.notes}
                                      </span>
                                    ) : (
                                      <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                                        Click to add note
                                      </span>
                                    )}
                                  </button>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                {lineItem?.quantity || 0}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                {formatCurrency(lineItem?.unitPrice || "0")}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                                {formatCurrency(total.toString())}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <div className="flex items-center justify-end space-x-2">
                                  <button
                                    onClick={() => handleEditLineItem(item)}
                                    className="p-1.5 text-white bg-blue-600 rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors duration-150"
                                    title="Edit Line Item"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      width="16"
                                      height="16"
                                      fill="currentColor"
                                      viewBox="0 0 16 16"
                                    >
                                      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleDeleteLineItem(lineItem?.id || 0)
                                    }
                                    className="p-1.5 text-white bg-red-600 rounded hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-colors duration-150"
                                    title="Delete"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      width="16"
                                      height="16"
                                      fill="currentColor"
                                      viewBox="0 0 16 16"
                                    >
                                      <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15h9.286zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zM.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8H.8z" />
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* Attributes row - only shown when toggle is on */}
                            {showPartAttributes && part && (
                              <tr className="bg-white dark:bg-gray-800">
                                <td
                                  colSpan={7}
                                  className="px-6 py-3 border-t border-gray-200 dark:border-gray-700"
                                >
                                  <div className="space-y-4">
                                    {/* Material/Tolerance/Finishing Grid */}
                                    <div className="grid grid-cols-3 gap-6">
                                      {/* Material */}
                                      <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">
                                          Material
                                        </span>
                                        {editingAttributeField?.partId ===
                                          part.id &&
                                        editingAttributeField?.field ===
                                          "material" ? (
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={editingAttributeValue}
                                              onChange={(e) =>
                                                setEditingAttributeValue(
                                                  e.target.value
                                                )
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  handleSaveAttribute(
                                                    part.id,
                                                    "material"
                                                  );
                                                } else if (e.key === "Escape") {
                                                  handleCancelEditAttribute();
                                                }
                                              }}
                                              className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                              placeholder="Material"
                                            />
                                            <button
                                              onClick={() =>
                                                handleSaveAttribute(
                                                  part.id,
                                                  "material"
                                                )
                                              }
                                              className="p-1 text-green-600 hover:text-green-700 dark:text-green-400"
                                              title="Save"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                                viewBox="0 0 16 16"
                                              >
                                                <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                              </svg>
                                            </button>
                                            <button
                                              onClick={
                                                handleCancelEditAttribute
                                              }
                                              className="p-1 text-red-600 hover:text-red-700 dark:text-red-400"
                                              title="Cancel"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                                viewBox="0 0 16 16"
                                              >
                                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                              </svg>
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() =>
                                              handleStartEditAttribute(
                                                part.id,
                                                "material",
                                                part.material
                                              )
                                            }
                                            className="text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            title="Click to edit"
                                          >
                                            <span className="text-sm text-gray-900 dark:text-gray-100">
                                              {part.material || (
                                                <span className="text-gray-400 dark:text-gray-500 italic">
                                                  Click to add
                                                </span>
                                              )}
                                            </span>
                                          </button>
                                        )}
                                      </div>

                                      {/* Tolerance */}
                                      <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">
                                          Tolerance
                                        </span>
                                        {editingAttributeField?.partId ===
                                          part.id &&
                                        editingAttributeField?.field ===
                                          "tolerance" ? (
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={editingAttributeValue}
                                              onChange={(e) =>
                                                handleToleranceChange(
                                                  e.target.value
                                                )
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  handleSaveAttribute(
                                                    part.id,
                                                    "tolerance"
                                                  );
                                                } else if (e.key === "Escape") {
                                                  handleCancelEditAttribute();
                                                }
                                              }}
                                              className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                              placeholder="Tolerance"
                                            />
                                            <button
                                              onClick={() =>
                                                handleSaveAttribute(
                                                  part.id,
                                                  "tolerance"
                                                )
                                              }
                                              className="p-1 text-green-600 hover:text-green-700 dark:text-green-400"
                                              title="Save"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                                viewBox="0 0 16 16"
                                              >
                                                <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                              </svg>
                                            </button>
                                            <button
                                              onClick={
                                                handleCancelEditAttribute
                                              }
                                              className="p-1 text-red-600 hover:text-red-700 dark:text-red-400"
                                              title="Cancel"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                                viewBox="0 0 16 16"
                                              >
                                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                              </svg>
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() =>
                                              handleStartEditAttribute(
                                                part.id,
                                                "tolerance",
                                                part.tolerance
                                              )
                                            }
                                            className="text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            title="Click to edit"
                                          >
                                            <span className="text-sm text-gray-900 dark:text-gray-100">
                                              {part.tolerance || (
                                                <span className="text-gray-400 dark:text-gray-500 italic">
                                                  Click to add
                                                </span>
                                              )}
                                            </span>
                                          </button>
                                        )}
                                      </div>

                                      {/* Finishing */}
                                      <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">
                                          Finishing
                                        </span>
                                        {editingAttributeField?.partId ===
                                          part.id &&
                                        editingAttributeField?.field ===
                                          "finishing" ? (
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={editingAttributeValue}
                                              onChange={(e) =>
                                                setEditingAttributeValue(
                                                  e.target.value
                                                )
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  handleSaveAttribute(
                                                    part.id,
                                                    "finishing"
                                                  );
                                                } else if (e.key === "Escape") {
                                                  handleCancelEditAttribute();
                                                }
                                              }}
                                              className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                              placeholder="Finishing"
                                            />
                                            <button
                                              onClick={() =>
                                                handleSaveAttribute(
                                                  part.id,
                                                  "finishing"
                                                )
                                              }
                                              className="p-1 text-green-600 hover:text-green-700 dark:text-green-400"
                                              title="Save"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                                viewBox="0 0 16 16"
                                              >
                                                <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                              </svg>
                                            </button>
                                            <button
                                              onClick={
                                                handleCancelEditAttribute
                                              }
                                              className="p-1 text-red-600 hover:text-red-700 dark:text-red-400"
                                              title="Cancel"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                                viewBox="0 0 16 16"
                                              >
                                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                              </svg>
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() =>
                                              handleStartEditAttribute(
                                                part.id,
                                                "finishing",
                                                part.finishing
                                              )
                                            }
                                            className="text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            title="Click to edit"
                                          >
                                            <span className="text-sm text-gray-900 dark:text-gray-100">
                                              {part.finishing || (
                                                <span className="text-gray-400 dark:text-gray-500 italic">
                                                  Click to add
                                                </span>
                                              )}
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-3 text-right text-sm font-medium text-gray-900 dark:text-gray-100"
                        >
                          Subtotal:
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-gray-100">
                          {formatCurrency(orderTotalPrice)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No line items added yet.
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
                  Order Notes
                </h3>
                {!isAddingNote && (
                  <Button size="sm" onClick={() => setIsAddingNote(true)}>
                    Add Note
                  </Button>
                )}
              </div>
              <div className="p-6">
                <Notes
                  entityType="order"
                  entityId={order.id.toString()}
                  initialNotes={notes}
                  currentUserId={user.id || user.email}
                  currentUserName={userDetails?.name || user.email}
                  showHeader={false}
                  onAddNoteClick={() => setIsAddingNote(false)}
                  isAddingNote={isAddingNote}
                  externalControl={true}
                />
              </div>
            </div>

            {/* Event Log */}
            <EventTimeline
              entityType="order"
              entityId={order.id.toString()}
              entityName={order.orderNumber}
              initialEvents={events}
            />
          </div>

          {/* Vendor Information */}
          {vendor && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Vendor Information
                </h3>
                <a
                  href={`/vendors/${vendor.id}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                >
                  View Vendor
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                    />
                  </svg>
                </a>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Vendor
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {vendor.displayName}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Company
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {vendor.companyName || "--"}
                    </p>
                  </div>
                  {vendor.contactName && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Contact
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {vendor.contactName}
                      </p>
                    </div>
                  )}
                  {vendor.email && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Email
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {vendor.email}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Attachments Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Attachments
              </h3>
              <Button size="sm" onClick={handleFileUpload}>
                Upload File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                style={{ display: "none" }}
                accept="*/*"
              />
            </div>
            <div className="p-6">
              {order.attachments && order.attachments.length > 0 ? (
                <div className="space-y-3">
                  {order.attachments.map((attachment: Attachment) => (
                    <div
                      key={attachment.id}
                      className={`
                        flex items-center justify-between p-4 rounded-lg
                        transition-all duration-300 ease-out
                        ${
                          isViewableFile(
                            attachment.fileName,
                            attachment.contentType
                          )
                            ? "bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer hover:scale-[1.02] hover:shadow-md focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none"
                            : "bg-gray-50 dark:bg-gray-700"
                        }
                      `}
                      onClick={
                        isViewableFile(
                          attachment.fileName,
                          attachment.contentType
                        )
                          ? () => handleViewFile(attachment)
                          : undefined
                      }
                      onKeyDown={
                        isViewableFile(
                          attachment.fileName,
                          attachment.contentType
                        )
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleViewFile(attachment);
                              }
                            }
                          : undefined
                      }
                      role={
                        isViewableFile(
                          attachment.fileName,
                          attachment.contentType
                        )
                          ? "button"
                          : undefined
                      }
                      tabIndex={
                        isViewableFile(
                          attachment.fileName,
                          attachment.contentType
                        )
                          ? 0
                          : undefined
                      }
                    >
                      <div className="flex-1 pointer-events-none">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {attachment.fileName}
                          </p>
                          {isViewableFile(
                            attachment.fileName,
                            attachment.contentType
                          ) && (
                            <span className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                              {getFileType(
                                attachment.fileName,
                                attachment.contentType
                              ).type.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatFileSize(attachment.fileSize || 0)} • Uploaded{" "}
                          {formatDate(attachment.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <a
                          href={`/attachments/${attachment.id}/download`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/50 rounded transition-colors"
                          title="Download"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                          </svg>
                        </a>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAttachment(attachment.id);
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/50 rounded transition-colors"
                          title="Delete"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                            <path
                              fillRule="evenodd"
                              d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No attachments uploaded yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* File Viewer Modal */}
      {selectedFile && (
        <FileViewerModal
          isOpen={fileModalOpen}
          onClose={() => {
            setFileModalOpen(false);
            setSelectedFile(null);
          }}
          fileUrl={selectedFile.url}
          fileName={selectedFile.fileName}
          contentType={selectedFile.contentType}
          fileSize={selectedFile.fileSize}
          onDelete={
            selectedFile.drawingId && selectedFile.partId
              ? () =>
                  handleDeleteDrawing(
                    selectedFile.drawingId!,
                    selectedFile.partId!
                  )
              : undefined
          }
          isDeleting={drawingDeleteFetcher.state === "submitting"}
        />
      )}

      {/* Line Item Modal */}
      <LineItemModal
        isOpen={lineItemModalOpen}
        onClose={handleCloseLineItemModal}
        onSubmit={handleLineItemSubmit}
        lineItem={selectedLineItem}
        mode={lineItemMode}
        customerId={order.customerId}
        parts={parts}
      />

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
          entityType="part"
          cadFileUrl={selectedPart3D.cadFileUrl}
          canRevise={canRevise}
          onThumbnailUpdate={() => {
            revalidator.revalidate();
          }}
          onRevisionComplete={() => {
            revalidator.revalidate();
          }}
          autoGenerateThumbnail={true}
          existingThumbnailUrl={selectedPart3D.thumbnailUrl}
          bananaEnabled={bananaEnabled}
          bananaModelUrl={bananaModelUrl || undefined}
        />
      )}

      {/* Purchase Order PDF Modal */}
      <GeneratePurchaseOrderPdfModal
        isOpen={isPOModalOpen}
        onClose={() => setIsPOModalOpen(false)}
        order={order}
        lineItems={lineItems.map((item: LineItemWithPart) => item.lineItem)}
        parts={lineItems.map((item: LineItemWithPart) => item.part)}
        autoDownload={pdfAutoDownload}
      />

      {/* Invoice PDF Modal */}
      <GenerateInvoicePdfModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        entity={order}
        lineItems={lineItems.map((item: LineItemWithPart) => item.lineItem)}
        parts={lineItems.map((item: LineItemWithPart) => item.part)}
        autoDownload={pdfAutoDownload}
      />

      {/* Assign Shop Modal */}
      {assignShopModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Assign Shop to Order
              </h2>
              <button
                onClick={() => setAssignShopModalOpen(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="vendor-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Select Vendor (Shop)
                </label>
                <select
                  id="vendor-select"
                  value={selectedVendorId || ""}
                  onChange={(e) =>
                    setSelectedVendorId(
                      e.target.value ? parseInt(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- Select a vendor --</option>
                  {vendors.map((v: Vendor) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Assigning a shop will move the order to &quot;In
                  Production&quot; status.
                </p>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <Button
                  variant="secondary"
                  onClick={() => setAssignShopModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleAssignShopSubmit}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Assign Shop
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Vendor Modal */}
      {manageVendorModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Manage Vendor
              </h2>
              <button
                onClick={() => setManageVendorModalOpen(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="vendor-manage-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Select Vendor
                </label>
                <select
                  id="vendor-manage-select"
                  value={selectedVendorId || ""}
                  onChange={(e) =>
                    setSelectedVendorId(
                      e.target.value ? parseInt(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- No vendor --</option>
                  {vendors.map((v: Vendor) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 justify-between mt-6">
                <div className="flex gap-3">
                  {order.vendorId && (
                    <Button
                      variant="secondary"
                      onClick={handleRemoveVendor}
                      className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                    >
                      Remove Vendor
                    </Button>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setManageVendorModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleManageVendorSubmit}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Update Vendor
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editOrderModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Edit Order Information
              </h2>
              <button
                onClick={() => setEditOrderModalOpen(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ship-date-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Due Date
                </label>
                <input
                  id="ship-date-input"
                  type="date"
                  value={editOrderForm.shipDate}
                  onChange={(e) => {
                    const newShipDate = e.target.value;
                    if (!newShipDate) {
                      setEditOrderForm({
                        ...editOrderForm,
                        shipDate: "",
                        leadTime: "",
                      });
                      return;
                    }

                    // Calculate lead time in calendar days from today to the new ship date
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const shipDate = new Date(newShipDate);
                    const diffInMs = shipDate.getTime() - today.getTime();
                    const diffInDays = Math.round(
                      diffInMs / (1000 * 60 * 60 * 24)
                    );

                    setEditOrderForm({
                      ...editOrderForm,
                      shipDate: newShipDate,
                      leadTime: diffInDays >= 0 ? diffInDays.toString() : "0",
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="lead-time-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Lead Time (Days)
                </label>
                <input
                  id="lead-time-input"
                  type="number"
                  value={editOrderForm.leadTime}
                  onChange={(e) => {
                    const input = e.target.value;
                    if (input === "") {
                      setEditOrderForm({
                        ...editOrderForm,
                        leadTime: "",
                        shipDate: "",
                      });
                      return;
                    }

                    const leadTimeDays = parseInt(input);
                    if (isNaN(leadTimeDays) || leadTimeDays < 0) return;

                    // Calculate ship date by adding lead time days to today
                    const today = new Date();
                    const shipDate = new Date(
                      today.getTime() + leadTimeDays * 24 * 60 * 60 * 1000
                    );
                    const shipDateString = shipDate.toISOString().split("T")[0];

                    setEditOrderForm({
                      ...editOrderForm,
                      leadTime: input,
                      shipDate: shipDateString,
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g., 10"
                  min="0"
                />
              </div>

              <div className="space-y-4">
                <div className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Vendor Pay
                </div>

                {/* Dual synchronized inputs */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Percentage Input */}
                  <div>
                    <label
                      htmlFor="vendor-pay-percent"
                      className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                    >
                      Percentage
                    </label>
                    <div className="relative">
                      <input
                        id="vendor-pay-percent"
                        type="number"
                        value={editOrderForm.vendorPayPercent}
                        onChange={(e) => {
                          const input = e.target.value;
                          // Allow empty input
                          if (input === "") {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayPercent: "",
                              vendorPayDollar: "",
                            });
                            return;
                          }

                          // Validate and clamp percentage between 0-100
                          let percentage = parseFloat(input);
                          if (isNaN(percentage)) return; // Don't update if invalid
                          percentage = Math.max(0, Math.min(100, percentage));

                          const total = Math.max(
                            0,
                            parseFloat(order.totalPrice || "0")
                          );
                          const dollarAmount = (
                            (percentage / 100) *
                            total
                          ).toFixed(2);

                          setEditOrderForm({
                            ...editOrderForm,
                            vendorPayPercent: input,
                            vendorPayDollar: dollarAmount,
                          });
                        }}
                        onBlur={(e) => {
                          // Clean up display on blur
                          const percentage = parseFloat(e.target.value);
                          if (!isNaN(percentage)) {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayPercent: Math.max(
                                0,
                                Math.min(100, percentage)
                              ).toFixed(1),
                            });
                          }
                        }}
                        className="w-full pl-3 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="70"
                        min="0"
                        max="100"
                        step="0.1"
                      />
                      <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none">
                        %
                      </span>
                    </div>
                  </div>

                  {/* Dollar Input */}
                  <div>
                    <label
                      htmlFor="vendor-pay-dollar"
                      className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                    >
                      Dollar Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none">
                        $
                      </span>
                      <input
                        id="vendor-pay-dollar"
                        type="number"
                        value={editOrderForm.vendorPayDollar}
                        onChange={(e) => {
                          const input = e.target.value;
                          // Allow empty input
                          if (input === "") {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayDollar: "",
                              vendorPayPercent: "",
                            });
                            return;
                          }

                          // Validate input
                          let dollarAmount = parseFloat(input);
                          if (isNaN(dollarAmount)) return; // Don't update if invalid
                          dollarAmount = Math.max(0, dollarAmount);

                          const total = Math.max(
                            0,
                            parseFloat(order.totalPrice || "0")
                          );
                          const percentage =
                            total > 0
                              ? Math.min(
                                  100,
                                  (dollarAmount / total) * 100
                                ).toFixed(1)
                              : "0";

                          setEditOrderForm({
                            ...editOrderForm,
                            vendorPayDollar: input,
                            vendorPayPercent: percentage,
                          });
                        }}
                        onBlur={(e) => {
                          // Clean up display on blur
                          const dollarAmount = parseFloat(e.target.value);
                          if (!isNaN(dollarAmount)) {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayDollar: Math.max(
                                0,
                                dollarAmount
                              ).toFixed(2),
                            });
                          }
                        }}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="500.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                </div>

                {/* Summary info */}
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md text-sm space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">
                      Order Total:
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      ${parseFloat(order.totalPrice || "0").toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">
                      Vendor Pay:
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {(() => {
                        const dollarVal = parseFloat(
                          editOrderForm.vendorPayDollar || "0"
                        );
                        const percentVal = parseFloat(
                          editOrderForm.vendorPayPercent || "0"
                        );
                        return `$${dollarVal.toFixed(2)} (${percentVal.toFixed(
                          1
                        )}%)`;
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-gray-600 dark:text-gray-400">
                      Profit Margin:
                    </span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {(() => {
                        const orderTotal = parseFloat(order.totalPrice || "0");
                        const vendorPay = parseFloat(
                          editOrderForm.vendorPayDollar || "0"
                        );
                        const profit = Math.max(0, orderTotal - vendorPay);
                        const profitPercent =
                          orderTotal > 0 ? (profit / orderTotal) * 100 : 0;
                        return `$${profit.toFixed(2)} (${profitPercent.toFixed(
                          1
                        )}%)`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <Button
                  variant="secondary"
                  onClick={() => setEditOrderModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleEditOrderSubmit}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
