/**
 * Quotes Management Module
 *
 * Error Handling Convention:
 * - Query functions (getQuote, getQuotes): Return null on error, log to console
 * - Creation functions (createQuote, createQuotePart): Return null on error, log to console
 * - Update functions (updateQuote, updateQuotePart): Return null on error, log to console
 * - Delete/Archive functions: Return boolean (false on error)
 * - Validation functions: Throw Error with descriptive message
 * - Conversion functions: Return {success: boolean, error?: string} object
 *
 * All errors are logged to console. Critical errors are also logged as events for tracking.
 */
import { db } from "./db/index.js";
import {
  quotes,
  customers,
  vendors,
  quoteLineItems,
  quoteParts,
  orders,
  orderLineItems,
  parts,
  attachments,
  quotePartDrawings,
  quoteAttachments,
  orderAttachments,
  notes,
  partDrawings,
  cadFileVersions,
} from "./db/schema.js";
import { eq, desc, and, lte, isNull, sql } from "drizzle-orm";
import type {
  Customer,
  Vendor,
  QuoteLineItem,
  QuotePart,
  Quote,
  NewQuote,
} from "./db/schema.js";
import {
  getNextQuoteNumber,
  generateUniqueOrderNumber,
} from "./number-generator.js";
import { createEvent } from "./events.js";
import { uploadFile, copyFile } from "./s3.server.js";
import { triggerQuotePartMeshConversion } from "./quote-part-mesh-converter.server.js";
import { generatePdfThumbnail, isPdfFile } from "./pdf-thumbnail.server.js";
import crypto from "crypto";

export type QuoteWithRelations = {
  id: number;
  quoteNumber: string;
  customerId: number;
  vendorId: number | null;
  status:
    | "RFQ"
    | "Draft"
    | "Sent"
    | "Accepted"
    | "Rejected"
    | "Dropped"
    | "Expired";
  validUntil: Date | null;
  expirationDays: number | null;
  sentAt: Date | null;
  expiredAt: Date | null;
  archivedAt: Date | null;
  subtotal: string | null;
  total: string | null;
  createdById: string | null;
  convertedToOrderId: number | null;
  rejectionReason: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  customer?: Customer | null;
  vendor?: Vendor | null;
  lineItems?: QuoteLineItem[];
  parts?: QuotePart[];
};

export type QuoteInput = {
  quoteNumber?: string | null;
  customerId: number;
  vendorId?: number | null;
  status?:
    | "RFQ"
    | "Draft"
    | "Sent"
    | "Accepted"
    | "Rejected"
    | "Dropped"
    | "Expired";
  validUntil?: Date | null;
  expirationDays?: number | null;
  rejectionReason?: string | null;
  createdById?: string | null;
};

export type QuoteEventContext = {
  userId?: string;
  userEmail?: string;
};

export async function getQuotes(
  includeArchived = false
): Promise<QuoteWithRelations[]> {
  try {
    // Check and update expired quotes before fetching
    await checkAndUpdateExpiredQuotes();

    // Fetch all quotes with customers and vendors using joins
    const quotesWithBasicRelations = await db
      .select({
        quote: quotes,
        customer: customers,
        vendor: vendors,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .where(includeArchived ? sql`1=1` : eq(quotes.isArchived, false))
      .orderBy(desc(quotes.createdAt));

    if (!quotesWithBasicRelations.length) return [];

    // Fetch all line items for these quotes in bulk
    const quoteIds = quotesWithBasicRelations.map((q) => q.quote.id);
    const allLineItems = await db
      .select()
      .from(quoteLineItems)
      .where(
        sql`${quoteLineItems.quoteId} IN ${sql.raw(`(${quoteIds.join(",")})`)}`
      )
      .orderBy(quoteLineItems.sortOrder);

    // Fetch all parts for these quotes in bulk
    const allParts = await db
      .select()
      .from(quoteParts)
      .where(
        sql`${quoteParts.quoteId} IN ${sql.raw(`(${quoteIds.join(",")})`)}`
      );

    // Group line items and parts by quote ID
    const lineItemsByQuote = new Map<number, typeof allLineItems>();
    const partsByQuote = new Map<number, typeof allParts>();

    allLineItems.forEach((item) => {
      const items = lineItemsByQuote.get(item.quoteId) || [];
      items.push(item);
      lineItemsByQuote.set(item.quoteId, items);
    });

    allParts.forEach((part) => {
      const parts = partsByQuote.get(part.quoteId) || [];
      parts.push(part);
      partsByQuote.set(part.quoteId, parts);
    });

    // Assemble final results
    return quotesWithBasicRelations.map(({ quote, customer, vendor }) => ({
      ...quote,
      customer,
      vendor,
      lineItems: lineItemsByQuote.get(quote.id) || [],
      parts: partsByQuote.get(quote.id) || [],
    }));
  } catch (error) {
    console.error("Error fetching quotes:", error);
    return [];
  }
}

export async function getQuote(id: number): Promise<QuoteWithRelations | null> {
  try {
    // Check and update expired quotes before fetching
    await checkAndUpdateExpiredQuotes();

    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);

    if (!quote) return null;

    const [customer, vendor, lineItems, parts] = await Promise.all([
      quote.customerId
        ? db
            .select()
            .from(customers)
            .where(eq(customers.id, quote.customerId))
            .limit(1)
        : [null],
      quote.vendorId
        ? db
            .select()
            .from(vendors)
            .where(eq(vendors.id, quote.vendorId))
            .limit(1)
        : [null],
      db
        .select()
        .from(quoteLineItems)
        .where(eq(quoteLineItems.quoteId, quote.id))
        .orderBy(quoteLineItems.sortOrder),
      db.select().from(quoteParts).where(eq(quoteParts.quoteId, quote.id)),
    ]);

    return {
      ...quote,
      customer: customer[0],
      vendor: vendor[0],
      lineItems,
      parts,
    };
  } catch (error) {
    console.error("Error fetching quote:", error);
    return null;
  }
}

export async function createQuote(
  input: QuoteInput,
  context?: QuoteEventContext
): Promise<Quote | null> {
  try {
    const quoteNumber = input.quoteNumber || (await getNextQuoteNumber());

    const [newQuote] = await db
      .insert(quotes)
      .values({
        quoteNumber,
        customerId: input.customerId,
        vendorId: input.vendorId,
        status: input.status || "RFQ",
        validUntil: input.validUntil,
        expirationDays: input.expirationDays,
        createdById: input.createdById || context?.userId,
        rejectionReason: input.rejectionReason,
      })
      .returning();

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: newQuote.id.toString(),
      eventType: "quote_created",
      eventCategory: "system",
      title: "Quote Created",
      description: `Quote ${quoteNumber} was created`,
      metadata: {
        quoteNumber,
        customerId: input.customerId,
        status: newQuote.status,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return newQuote;
  } catch (error) {
    console.error("Error creating quote:", error);
    return null;
  }
}

export async function updateQuote(
  id: number,
  updates: Partial<QuoteInput>,
  context?: QuoteEventContext
): Promise<Quote | null> {
  try {
    const oldQuote = await getQuote(id);
    if (!oldQuote) {
      throw new Error("Quote not found");
    }

    const updateData: Partial<Omit<NewQuote, "quoteNumber">> = {
      ...updates,
      updatedAt: new Date(),
    };

    // Handle status transitions
    if (updates.status === "Sent" && oldQuote.status !== "Sent") {
      updateData.sentAt = new Date();

      // Calculate validUntil if not already set
      if (!updateData.validUntil) {
        const expirationDays =
          updates.expirationDays || oldQuote.expirationDays || 14;
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + expirationDays);
        updateData.validUntil = validUntil;
      }
    }

    if (updates.status === "Accepted" && oldQuote.status !== "Accepted") {
      updateData.acceptedAt = new Date();
    }

    if (updates.status === "Expired" && oldQuote.status !== "Expired") {
      updateData.expiredAt = new Date();
    }

    const [updatedQuote] = await db
      .update(quotes)
      .set(updateData)
      .where(eq(quotes.id, id))
      .returning();

    // Log status change events
    if (updates.status && updates.status !== oldQuote.status) {
      await createEvent({
        entityType: "quote",
        entityId: id.toString(),
        eventType: "quote_status_changed",
        eventCategory: "status",
        title: "Quote Status Updated",
        description: `Quote status changed from ${oldQuote.status} to ${updates.status}`,
        metadata: {
          oldStatus: oldQuote.status,
          newStatus: updates.status,
          quoteNumber: oldQuote.quoteNumber,
        },
        userId: context?.userId,
        userEmail: context?.userEmail,
      });
    }

    // Log vendor change events
    if (
      updates.vendorId !== undefined &&
      updates.vendorId !== oldQuote.vendorId
    ) {
      // Fetch vendor names for the event
      let oldVendorName = "None";
      let newVendorName = "None";

      if (oldQuote.vendorId) {
        const oldVendor = await db
          .select()
          .from(vendors)
          .where(eq(vendors.id, oldQuote.vendorId))
          .limit(1);
        if (oldVendor[0]) {
          oldVendorName = oldVendor[0].displayName;
        }
      }

      if (updates.vendorId) {
        const newVendor = await db
          .select()
          .from(vendors)
          .where(eq(vendors.id, updates.vendorId))
          .limit(1);
        if (newVendor[0]) {
          newVendorName = newVendor[0].displayName;
        }
      }

      await createEvent({
        entityType: "quote",
        entityId: id.toString(),
        eventType: "quote_vendor_changed",
        eventCategory: "system",
        title: "Quote Vendor Updated",
        description: `Quote vendor changed from ${oldVendorName} to ${newVendorName}`,
        metadata: {
          oldVendorId: oldQuote.vendorId,
          newVendorId: updates.vendorId,
          oldVendorName,
          newVendorName,
          quoteNumber: oldQuote.quoteNumber,
        },
        userId: context?.userId,
        userEmail: context?.userEmail,
      });
    }

    // Log customer change events
    if (
      updates.customerId !== undefined &&
      updates.customerId !== oldQuote.customerId
    ) {
      // Fetch customer names for the event
      let oldCustomerName = "Unknown";
      let newCustomerName = "Unknown";

      if (oldQuote.customerId) {
        const oldCustomer = await db
          .select()
          .from(customers)
          .where(eq(customers.id, oldQuote.customerId))
          .limit(1);
        if (oldCustomer[0]) {
          oldCustomerName = oldCustomer[0].displayName;
        }
      }

      if (updates.customerId) {
        const newCustomer = await db
          .select()
          .from(customers)
          .where(eq(customers.id, updates.customerId))
          .limit(1);
        if (newCustomer[0]) {
          newCustomerName = newCustomer[0].displayName;
        }
      }

      await createEvent({
        entityType: "quote",
        entityId: id.toString(),
        eventType: "quote_customer_changed",
        eventCategory: "system",
        title: "Quote Customer Updated",
        description: `Quote customer changed from ${oldCustomerName} to ${newCustomerName}`,
        metadata: {
          oldCustomerId: oldQuote.customerId,
          newCustomerId: updates.customerId,
          oldCustomerName,
          newCustomerName,
          quoteNumber: oldQuote.quoteNumber,
        },
        userId: context?.userId,
        userEmail: context?.userEmail,
      });
    }

    return updatedQuote;
  } catch (error) {
    console.error("Error updating quote:", error);
    return null;
  }
}

export async function archiveQuote(
  id: number,
  context?: QuoteEventContext
): Promise<boolean> {
  try {
    const quote = await getQuote(id);
    if (!quote) {
      throw new Error("Quote not found");
    }

    await db
      .update(quotes)
      .set({
        isArchived: true,
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id));

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: id.toString(),
      eventType: "quote_archived",
      eventCategory: "system",
      title: "Quote Archived",
      description: `Quote ${quote.quoteNumber} was archived`,
      metadata: {
        quoteNumber: quote.quoteNumber,
        previousStatus: quote.status,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return true;
  } catch (error) {
    console.error("Error archiving quote:", error);
    return false;
  }
}

export async function restoreQuote(
  id: number,
  context?: QuoteEventContext
): Promise<boolean> {
  try {
    const quote = await getQuote(id);
    if (!quote) {
      throw new Error("Quote not found");
    }

    await db
      .update(quotes)
      .set({
        isArchived: false,
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id));

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: id.toString(),
      eventType: "quote_restored",
      eventCategory: "system",
      title: "Quote Restored",
      description: `Quote ${quote.quoteNumber} was restored from archive`,
      metadata: {
        quoteNumber: quote.quoteNumber,
        status: quote.status,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return true;
  } catch (error) {
    console.error("Error restoring quote:", error);
    return false;
  }
}

export async function convertQuoteToOrder(
  quoteId: number,
  context?: QuoteEventContext
): Promise<{
  success: boolean;
  orderId?: number;
  orderNumber?: string;
  error?: string;
}> {
  try {
    const quote = await getQuote(quoteId);
    if (!quote) {
      return { success: false, error: "Quote not found" };
    }

    if (quote.status !== "Accepted" && quote.status !== "Sent") {
      return {
        success: false,
        error: "Quote must be in Accepted or Sent status to convert",
      };
    }

    if (quote.convertedToOrderId) {
      return {
        success: false,
        error: "Quote has already been converted to an order",
      };
    }

    // Validation: Ensure quote has line items
    if (!quote.lineItems || quote.lineItems.length === 0) {
      return {
        success: false,
        error: "Cannot convert quote with no line items",
      };
    }

    // Validation: Ensure all line items have valid quantities and prices
    for (const item of quote.lineItems) {
      if (item.quantity <= 0) {
        return {
          success: false,
          error: `Line item has invalid quantity: ${item.quantity}`,
        };
      }
      const unitPrice = parseFloat(item.unitPrice || "0");
      if (unitPrice < 0) {
        return {
          success: false,
          error: `Line item has invalid price: ${unitPrice}`,
        };
      }
    }

    // Validation: Ensure quote total is greater than 0
    const total = parseFloat(quote.total || "0");
    if (total <= 0) {
      return { success: false, error: "Cannot convert quote with $0 total" };
    }

    // Additional validation: Check if any quote parts have pending conversions
    if (quote.parts && quote.parts.length > 0) {
      const pendingConversions = quote.parts.filter(
        (part) =>
          part.conversionStatus === "in_progress" ||
          part.conversionStatus === "queued" ||
          (part.conversionStatus === "pending" && part.partFileUrl)
      );

      if (pendingConversions.length > 0) {
        return {
          success: false,
          error: `Cannot convert quote while ${pendingConversions.length} part(s) have pending mesh conversions. Please wait for all conversions to complete.`,
        };
      }

      // Warn about failed conversions but allow conversion to proceed
      const failedConversions = quote.parts.filter(
        (part) => part.conversionStatus === "failed"
      );

      if (failedConversions.length > 0) {
        console.warn(
          `Converting quote ${quoteId} with ${failedConversions.length} failed mesh conversions`
        );
      }

      // Validate that all quote parts have required fields
      for (const part of quote.parts) {
        if (!part.partName || part.partName.trim() === "") {
          return {
            success: false,
            error: `Quote part ${part.partNumber} is missing a name`,
          };
        }

        // Check if part has a corresponding line item
        const hasLineItem = quote.lineItems?.some(
          (item) => item.quotePartId === part.id
        );
        if (!hasLineItem) {
          return {
            success: false,
            error: `Quote part ${part.partName} has no associated line item with pricing`,
          };
        }
      }
    }

    // Generate a unique order number BEFORE the transaction
    // This uses retry logic to handle race conditions
    const orderNumber = await generateUniqueOrderNumber();

    // Start a transaction
    const result = await db.transaction(async (tx) => {
      // Create the order
      // Calculate total from quote line items to ensure accuracy
      const calculatedTotal =
        quote.lineItems?.reduce((sum, item) => {
          return sum + item.quantity * parseFloat(item.unitPrice || "0");
        }, 0) || 0;

      // Calculate vendor pay as 70% of total by default
      const defaultVendorPay = (calculatedTotal * 0.7).toFixed(2);

      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          customerId: quote.customerId,
          vendorId: quote.vendorId,
          sourceQuoteId: quoteId,
          status: "Pending",
          totalPrice: calculatedTotal.toFixed(2),
          vendorPay: defaultVendorPay, // Store as dollar amount (70% of total)
        })
        .returning();

      // Update quote with converted order ID and status
      // Use atomic check to prevent race condition - only update if not already converted
      const updatedQuotes = await tx
        .update(quotes)
        .set({
          convertedToOrderId: order.id,
          status: "Accepted",
          updatedAt: new Date(),
        })
        .where(and(eq(quotes.id, quoteId), isNull(quotes.convertedToOrderId)))
        .returning();

      // If no rows were updated, quote was already converted by another request
      if (updatedQuotes.length === 0) {
        throw new Error("Quote has already been converted to an order");
      }

      // Track which line items have been processed (those with associated parts)
      const processedLineItemIds = new Set<number>();

      // Convert quote parts to customer parts and create order line items
      if (quote.parts && quote.parts.length > 0) {
        for (const quotePart of quote.parts) {
          try {
            // Create a customer part from the quote part
            // First create with null URLs, then copy files and update
            const [customerPart] = await tx
              .insert(parts)
              .values({
                customerId: quote.customerId,
                partName: quotePart.partName,
                material: quotePart.material || null,
                tolerance: quotePart.tolerance || null,
                finishing: quotePart.finish || null,
                thumbnailUrl: null, // Will be updated after copying
                partFileUrl: null, // Will be updated after copying
                partMeshUrl: null, // Will be updated after copying
                meshConversionStatus: quotePart.conversionStatus || "pending",
                meshConversionError: quotePart.meshConversionError || null,
                meshConversionJobId: quotePart.meshConversionJobId || null,
                meshConversionStartedAt:
                  quotePart.meshConversionStartedAt || null,
                meshConversionCompletedAt:
                  quotePart.meshConversionCompletedAt || null,
                notes: quotePart.description || null,
              })
              .returning();

            if (!customerPart) {
              throw new Error(
                `Failed to create customer part for quote part: ${quotePart.partName}`
              );
            }

            // Copy CAD files from quote-parts location to parts location
            let newPartFileUrl: string | null = null;
            let newPartMeshUrl: string | null = null;
            let newThumbnailUrl: string | null = null;

            // Helper to extract S3 key from URL or path
            const extractS3Key = (urlOrPath: string): string | null => {
              if (!urlOrPath) return null;
              // Handle full URLs - extract everything starting from 'quote-parts/' or 'parts/'
              if (urlOrPath.startsWith("http")) {
                const quotePartsIdx = urlOrPath.indexOf("quote-parts/");
                if (quotePartsIdx >= 0) {
                  return urlOrPath.substring(quotePartsIdx);
                }
                const partsIdx = urlOrPath.indexOf("parts/");
                if (partsIdx >= 0) {
                  return urlOrPath.substring(partsIdx);
                }
                return null;
              }
              // Handle relative paths
              if (
                urlOrPath.startsWith("quote-parts/") ||
                urlOrPath.startsWith("parts/")
              ) {
                return urlOrPath;
              }
              return urlOrPath;
            };

            // Copy CAD source file
            if (quotePart.partFileUrl) {
              try {
                const sourceKey = extractS3Key(quotePart.partFileUrl);
                if (sourceKey) {
                  // Extract filename from source key
                  const fileName = sourceKey.split("/").pop() || "cad-file";
                  const destKey = `parts/${customerPart.id}/source/v1/${fileName}`;
                  await copyFile(sourceKey, destKey);
                  newPartFileUrl = destKey;
                }
              } catch (copyError) {
                console.warn(
                  `Failed to copy CAD file for part ${quotePart.partName}, falling back to reference:`,
                  copyError
                );
                newPartFileUrl = quotePart.partFileUrl; // Fall back to reference if copy fails
              }
            }

            // Copy mesh file
            if (quotePart.partMeshUrl) {
              try {
                const sourceKey = extractS3Key(quotePart.partMeshUrl);
                if (sourceKey) {
                  const fileName = sourceKey.split("/").pop() || "mesh.glb";
                  const destKey = `parts/${customerPart.id}/mesh/${fileName}`;
                  await copyFile(sourceKey, destKey);
                  newPartMeshUrl = destKey;
                }
              } catch (copyError) {
                console.warn(
                  `Failed to copy mesh file for part ${quotePart.partName}, falling back to reference:`,
                  copyError
                );
                newPartMeshUrl = quotePart.partMeshUrl; // Fall back to reference if copy fails
              }
            }

            // Copy thumbnail
            if (quotePart.thumbnailUrl) {
              try {
                const sourceKey = extractS3Key(quotePart.thumbnailUrl);
                if (sourceKey) {
                  const fileName =
                    sourceKey.split("/").pop() || "thumbnail.png";
                  const destKey = `parts/${customerPart.id}/thumbnails/${fileName}`;
                  await copyFile(sourceKey, destKey);
                  newThumbnailUrl = destKey;
                }
              } catch (copyError) {
                console.warn(
                  `Failed to copy thumbnail for part ${quotePart.partName}, falling back to reference:`,
                  copyError
                );
                newThumbnailUrl = quotePart.thumbnailUrl; // Fall back to reference if copy fails
              }
            }

            // Update part with new URLs
            await tx
              .update(parts)
              .set({
                partFileUrl: newPartFileUrl,
                partMeshUrl: newPartMeshUrl,
                thumbnailUrl: newThumbnailUrl,
                updatedAt: new Date(),
              })
              .where(eq(parts.id, customerPart.id));

            // Copy CAD version history from quote_part to part
            const quotePartVersions = await tx
              .select()
              .from(cadFileVersions)
              .where(
                and(
                  eq(cadFileVersions.entityType, "quote_part"),
                  eq(cadFileVersions.entityId, quotePart.id)
                )
              );

            if (quotePartVersions.length > 0) {
              for (const version of quotePartVersions) {
                try {
                  // Copy the versioned CAD file
                  const sourceKey = version.s3Key;
                  const fileName =
                    sourceKey.split("/").pop() || version.fileName;
                  const destKey = `parts/${customerPart.id}/source/v${version.version}/${fileName}`;

                  await copyFile(sourceKey, destKey);

                  // Create new version record for the part
                  await tx.insert(cadFileVersions).values({
                    entityType: "part",
                    entityId: customerPart.id,
                    version: version.version,
                    isCurrentVersion: version.isCurrentVersion,
                    s3Key: destKey,
                    fileName: version.fileName,
                    fileSize: version.fileSize,
                    contentType: version.contentType,
                    uploadedBy: version.uploadedBy,
                    uploadedByEmail: version.uploadedByEmail,
                    notes: version.notes,
                  });
                } catch (versionCopyError) {
                  console.warn(
                    `Failed to copy version ${version.version} for part ${quotePart.partName}:`,
                    versionCopyError
                  );
                  // Continue with other versions even if one fails
                }
              }
            }

            // Migrate quote part drawings to the new customer part
            const quotePartDrawingRecords = await tx
              .select({
                attachmentId: quotePartDrawings.attachmentId,
                version: quotePartDrawings.version,
              })
              .from(quotePartDrawings)
              .where(eq(quotePartDrawings.quotePartId, quotePart.id));

            if (quotePartDrawingRecords.length > 0) {
              await tx.insert(partDrawings).values(
                quotePartDrawingRecords.map((record) => ({
                  partId: customerPart.id,
                  attachmentId: record.attachmentId,
                  version: record.version,
                }))
              );
            }

            // Find the corresponding line item for this quote part
            const lineItem = quote.lineItems?.find(
              (li) => li.quotePartId === quotePart.id
            );

            if (lineItem) {
              // Create order line item with reference to the new customer part
              await tx.insert(orderLineItems).values({
                orderId: order.id,
                partId: customerPart.id,
                name: quotePart.partName,
                description:
                  lineItem.description || quotePart.description || "",
                quantity: lineItem.quantity,
                unitPrice: lineItem.unitPrice,
                notes: lineItem.notes || null,
              });

              // Mark this line item as processed
              processedLineItemIds.add(lineItem.id);
            }
          } catch (partConversionError) {
            // If any part conversion fails, rollback the entire transaction
            console.error(
              `Failed to convert quote part ${quotePart.partName}:`,
              partConversionError
            );
            throw new Error(
              `Failed to convert part "${quotePart.partName}": ${
                partConversionError instanceof Error
                  ? partConversionError.message
                  : "Unknown error"
              }`
            );
          }
        }
      }

      // Now handle any line items that don't have associated parts
      if (quote.lineItems && quote.lineItems.length > 0) {
        const unprocessedLineItems = quote.lineItems.filter(
          (item) => !processedLineItemIds.has(item.id)
        );

        if (unprocessedLineItems.length > 0) {
          // Create order line items for items without parts
          await tx.insert(orderLineItems).values(
            unprocessedLineItems.map((item) => ({
              orderId: order.id,
              partId: null,
              name: item.name || `Line item from quote ${quote.quoteNumber}`,
              description: item.description || "",
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              notes: item.notes || null,
            }))
          );
        }
      }

      // Migrate attachments from quote to order
      const quoteAttachmentRecords = await tx
        .select({ attachmentId: quoteAttachments.attachmentId })
        .from(quoteAttachments)
        .where(eq(quoteAttachments.quoteId, quoteId));

      if (quoteAttachmentRecords.length > 0) {
        await tx.insert(orderAttachments).values(
          quoteAttachmentRecords.map((record) => ({
            orderId: order.id,
            attachmentId: record.attachmentId,
          }))
        );
      }

      // Migrate notes from quote to order
      const quoteNotes = await tx
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.entityType, "quote"),
            eq(notes.entityId, quoteId.toString()),
            eq(notes.isArchived, false)
          )
        );

      if (quoteNotes.length > 0) {
        await tx.insert(notes).values(
          quoteNotes.map((note) => ({
            entityType: "order",
            entityId: order.id.toString(),
            content: note.content,
            createdBy: note.createdBy,
            isArchived: false,
          }))
        );
      }

      return { orderId: order.id, orderNumber: order.orderNumber };
    });

    // Log conversion event on quote
    await createEvent({
      entityType: "quote",
      entityId: quoteId.toString(),
      eventType: "quote_converted",
      eventCategory: "system",
      title: "Quote Converted to Order",
      description: `Quote ${quote.quoteNumber} was converted to order ${result.orderNumber}`,
      metadata: {
        quoteNumber: quote.quoteNumber,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    // Log creation event on order
    await createEvent({
      entityType: "order",
      entityId: result.orderId.toString(),
      eventType: "order_created",
      eventCategory: "system",
      title: "Order Created",
      description: `Quote ${quote.quoteNumber} accepted`,
      metadata: {
        orderNumber: result.orderNumber,
        sourceQuoteId: quoteId,
        quoteNumber: quote.quoteNumber,
        customerId: quote.customerId,
        vendorId: quote.vendorId,
        initialStatus: "Pending",
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return {
      success: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
    };
  } catch (error) {
    console.error("Error converting quote to order:", error);
    return { success: false, error: "Failed to convert quote to order" };
  }
}

export async function duplicateQuote(
  quoteId: number,
  context?: QuoteEventContext
): Promise<{
  success: boolean;
  quoteId?: number;
  quoteNumber?: string;
  error?: string;
}> {
  try {
    const quote = await getQuote(quoteId);
    if (!quote) {
      return { success: false, error: "Quote not found" };
    }

    // Generate a new quote number before the transaction
    const newQuoteNumber = await getNextQuoteNumber();

    const result = await db.transaction(async (tx) => {
      // Create the new quote record
      const [newQuote] = await tx
        .insert(quotes)
        .values({
          quoteNumber: newQuoteNumber,
          customerId: quote.customerId,
          vendorId: quote.vendorId,
          status: "RFQ",
          expirationDays: quote.expirationDays,
          subtotal: quote.subtotal,
          total: quote.total,
          createdById: context?.userId || quote.createdById,
          // Reset all date and status fields
          validUntil: null,
          sentAt: null,
          acceptedAt: null,
          expiredAt: null,
          archivedAt: null,
          convertedToOrderId: null,
          rejectionReason: null,
          isArchived: false,
        })
        .returning();

      // Map old quote part IDs to new quote part IDs for line item linking
      const partIdMap = new Map<string, string>();

      // Duplicate quote parts
      if (quote.parts && quote.parts.length > 0) {
        for (const sourcePart of quote.parts) {
          const [newPart] = await tx
            .insert(quoteParts)
            .values({
              quoteId: newQuote.id,
              partNumber: sourcePart.partNumber,
              partName: sourcePart.partName,
              description: sourcePart.description,
              material: sourcePart.material,
              finish: sourcePart.finish,
              tolerance: sourcePart.tolerance,
              specifications: sourcePart.specifications,
              // URLs will be updated after copying files
              thumbnailUrl: null,
              partFileUrl: null,
              partMeshUrl: null,
              conversionStatus: sourcePart.conversionStatus || "pending",
              meshConversionError: sourcePart.meshConversionError,
              meshConversionJobId: null,
              meshConversionStartedAt: null,
              meshConversionCompletedAt: null,
            })
            .returning();

          partIdMap.set(sourcePart.id, newPart.id);

          // Helper to extract S3 key from URL or path
          const extractS3Key = (urlOrPath: string): string | null => {
            if (!urlOrPath) return null;
            if (urlOrPath.startsWith("http")) {
              const quotePartsIdx = urlOrPath.indexOf("quote-parts/");
              if (quotePartsIdx >= 0) {
                return urlOrPath.substring(quotePartsIdx);
              }
              return null;
            }
            if (urlOrPath.startsWith("quote-parts/")) {
              return urlOrPath;
            }
            return urlOrPath;
          };

          // Copy CAD source file
          let newPartFileUrl: string | null = null;
          if (sourcePart.partFileUrl) {
            try {
              const sourceKey = extractS3Key(sourcePart.partFileUrl);
              if (sourceKey) {
                const fileName = sourceKey.split("/").pop() || "cad-file";
                const destKey = `quote-parts/${newPart.id}/source/${fileName}`;
                await copyFile(sourceKey, destKey);
                newPartFileUrl = destKey;
              }
            } catch (copyError) {
              console.warn(
                `Failed to copy CAD file for part ${sourcePart.partName}:`,
                copyError
              );
              newPartFileUrl = sourcePart.partFileUrl;
            }
          }

          // Copy mesh file
          let newPartMeshUrl: string | null = null;
          if (sourcePart.partMeshUrl) {
            try {
              const sourceKey = extractS3Key(sourcePart.partMeshUrl);
              if (sourceKey) {
                const fileName = sourceKey.split("/").pop() || "mesh.glb";
                const destKey = `quote-parts/${newPart.id}/mesh/${fileName}`;
                await copyFile(sourceKey, destKey);
                newPartMeshUrl = destKey;
              }
            } catch (copyError) {
              console.warn(
                `Failed to copy mesh file for part ${sourcePart.partName}:`,
                copyError
              );
              newPartMeshUrl = sourcePart.partMeshUrl;
            }
          }

          // Copy thumbnail
          let newThumbnailUrl: string | null = null;
          if (sourcePart.thumbnailUrl) {
            try {
              const sourceKey = extractS3Key(sourcePart.thumbnailUrl);
              if (sourceKey) {
                const fileName =
                  sourceKey.split("/").pop() || "thumbnail.png";
                const destKey = `quote-parts/${newPart.id}/thumbnails/${fileName}`;
                await copyFile(sourceKey, destKey);
                newThumbnailUrl = destKey;
              }
            } catch (copyError) {
              console.warn(
                `Failed to copy thumbnail for part ${sourcePart.partName}:`,
                copyError
              );
              newThumbnailUrl = sourcePart.thumbnailUrl;
            }
          }

          // Update the new part with copied file URLs
          await tx
            .update(quoteParts)
            .set({
              partFileUrl: newPartFileUrl,
              partMeshUrl: newPartMeshUrl,
              thumbnailUrl: newThumbnailUrl,
              updatedAt: new Date(),
            })
            .where(eq(quoteParts.id, newPart.id));

          // Copy CAD version history
          const sourceVersions = await tx
            .select()
            .from(cadFileVersions)
            .where(
              and(
                eq(cadFileVersions.entityType, "quote_part"),
                eq(cadFileVersions.entityId, sourcePart.id)
              )
            );

          if (sourceVersions.length > 0) {
            for (const version of sourceVersions) {
              try {
                const sourceKey = version.s3Key;
                const fileName =
                  sourceKey.split("/").pop() || version.fileName;
                const destKey = `quote-parts/${newPart.id}/source/v${version.version}/${fileName}`;
                await copyFile(sourceKey, destKey);

                await tx.insert(cadFileVersions).values({
                  entityType: "quote_part",
                  entityId: newPart.id,
                  version: version.version,
                  isCurrentVersion: version.isCurrentVersion,
                  s3Key: destKey,
                  fileName: version.fileName,
                  fileSize: version.fileSize,
                  contentType: version.contentType,
                  uploadedBy: version.uploadedBy,
                  uploadedByEmail: version.uploadedByEmail,
                  notes: version.notes,
                });
              } catch (versionCopyError) {
                console.warn(
                  `Failed to copy version ${version.version} for part ${sourcePart.partName}:`,
                  versionCopyError
                );
              }
            }
          }

          // Copy part drawings
          const sourceDrawings = await tx
            .select({
              attachmentId: quotePartDrawings.attachmentId,
              version: quotePartDrawings.version,
            })
            .from(quotePartDrawings)
            .where(eq(quotePartDrawings.quotePartId, sourcePart.id));

          if (sourceDrawings.length > 0) {
            await tx.insert(quotePartDrawings).values(
              sourceDrawings.map((drawing) => ({
                quotePartId: newPart.id,
                attachmentId: drawing.attachmentId,
                version: drawing.version,
              }))
            );
          }
        }
      }

      // Duplicate line items
      if (quote.lineItems && quote.lineItems.length > 0) {
        for (const item of quote.lineItems) {
          const newQuotePartId = item.quotePartId
            ? partIdMap.get(item.quotePartId) || null
            : null;

          await tx.insert(quoteLineItems).values({
            quoteId: newQuote.id,
            quotePartId: newQuotePartId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            leadTimeDays: item.leadTimeDays,
            description: item.description,
            // Exclude notes
            notes: null,
            sortOrder: item.sortOrder,
          });
        }
      }

      return { quoteId: newQuote.id, quoteNumber: newQuote.quoteNumber };
    });

    // Log duplication event on source quote
    await createEvent({
      entityType: "quote",
      entityId: quoteId.toString(),
      eventType: "quote_duplicated",
      eventCategory: "system",
      title: "Quote Duplicated",
      description: `Quote ${quote.quoteNumber} was duplicated as ${result.quoteNumber}`,
      metadata: {
        sourceQuoteId: quoteId,
        sourceQuoteNumber: quote.quoteNumber,
        newQuoteId: result.quoteId,
        newQuoteNumber: result.quoteNumber,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    // Log creation event on new quote
    await createEvent({
      entityType: "quote",
      entityId: result.quoteId.toString(),
      eventType: "quote_created",
      eventCategory: "system",
      title: "Quote Created (Duplicate)",
      description: `Duplicated from quote ${quote.quoteNumber}`,
      metadata: {
        sourceQuoteId: quoteId,
        sourceQuoteNumber: quote.quoteNumber,
        newQuoteNumber: result.quoteNumber,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return {
      success: true,
      quoteId: result.quoteId,
      quoteNumber: result.quoteNumber,
    };
  } catch (error) {
    console.error("Error duplicating quote:", error);
    return { success: false, error: "Failed to duplicate quote" };
  }
}

export async function calculateQuoteTotals(quoteId: number): Promise<{
  subtotal: number;
  total: number;
} | null> {
  try {
    const lineItems = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, quoteId));

    const subtotal = lineItems.reduce((sum, item) => {
      const totalPrice = parseFloat(item.totalPrice || "0");
      return sum + totalPrice;
    }, 0);

    // Total is same as subtotal - tax handled by financial platform
    const total = subtotal;

    // Update the quote with calculated totals
    await db
      .update(quotes)
      .set({
        subtotal: subtotal.toFixed(2),
        total: total.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));

    return { subtotal, total };
  } catch (error) {
    console.error("Error calculating quote totals:", error);
    return null;
  }
}

export async function checkAndUpdateExpiredQuotes(): Promise<number> {
  try {
    const now = new Date();

    // Find quotes that should be expired
    const expiredQuotes = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "Sent"),
          lte(quotes.validUntil, now),
          isNull(quotes.expiredAt)
        )
      );

    // Update each expired quote
    for (const quote of expiredQuotes) {
      await db
        .update(quotes)
        .set({
          status: "Expired",
          expiredAt: now,
          updatedAt: now,
        })
        .where(eq(quotes.id, quote.id));

      // Log expiration event
      await createEvent({
        entityType: "quote",
        entityId: quote.id.toString(),
        eventType: "quote_expired",
        eventCategory: "system",
        title: "Quote Expired",
        description: `Quote ${quote.quoteNumber} has expired`,
        metadata: {
          quoteNumber: quote.quoteNumber,
          validUntil: quote.validUntil,
        },
      });
    }

    return expiredQuotes.length;
  } catch (error) {
    console.error("Error checking expired quotes:", error);
    return 0;
  }
}

export async function createQuoteWithParts(
  quoteData: QuoteInput,
  partsData: Array<{
    file?: Buffer;
    fileName?: string;
    partName: string;
    material?: string;
    tolerances?: string;
    surfaceFinish?: string;
    quantity: number;
    notes?: string;
    drawings?: Array<{ buffer: Buffer; fileName: string }>;
  }>,
  context?: QuoteEventContext
): Promise<{ success: boolean; quoteId?: number; error?: string }> {
  try {
    const quote = await createQuote(quoteData, context);
    if (!quote) {
      throw new Error("Failed to create quote");
    }

    for (let i = 0; i < partsData.length; i++) {
      const part = partsData[i];

      // Create the quote part first to get its ID
      const [quotePart] = await db
        .insert(quoteParts)
        .values({
          quoteId: quote.id,
          partName: part.partName || `Part ${i + 1}`,
          partNumber: `PART-${Date.now()}-${i}`,
          material: part.material || null,
          finish: part.surfaceFinish || null,
          tolerance: part.tolerances || null,
          partFileUrl: null,
          conversionStatus: "pending",
          specifications: {
            tolerances: part.tolerances,
            notes: part.notes,
          },
        })
        .returning();

      // Now upload the file using the structured path with the quote part ID
      let partFileUrl: string | null = null;
      if (part.file && part.fileName) {
        const timestamp = Date.now();
        const randomString = crypto.randomBytes(8).toString("hex");
        const sanitizedFileName = part.fileName
          .replace(/\s+/g, "-")
          .replace(/[^a-zA-Z0-9._-]/g, "");
        const key = `quote-parts/${quotePart.id}/source/${timestamp}-${randomString}-${sanitizedFileName}`;

        const uploadResult = await uploadFile({
          key,
          buffer: part.file,
          contentType: "application/octet-stream",
          fileName: part.fileName,
        });
        partFileUrl = uploadResult.key;

        // Update the quote part with the file URL
        await db
          .update(quoteParts)
          .set({
            partFileUrl,
            updatedAt: new Date(),
          })
          .where(eq(quoteParts.id, quotePart.id));

        // Trigger mesh conversion if applicable
        await triggerQuotePartMeshConversion(quotePart.id, partFileUrl);
      }

      // Upload technical drawings if provided
      if (part.drawings && part.drawings.length > 0) {
        for (
          let drawingIndex = 0;
          drawingIndex < part.drawings.length;
          drawingIndex++
        ) {
          const drawing = part.drawings[drawingIndex];
          const timestamp = Date.now();
          const randomString = crypto.randomBytes(8).toString("hex");
          const sanitizedFileName = drawing.fileName
            .replace(/\s+/g, "-")
            .replace(/[^a-zA-Z0-9._-]/g, "");
          const contentType = drawing.fileName.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "image/png";
          const key = `quote-parts/${quotePart.id}/drawings/${timestamp}-${randomString}-${sanitizedFileName}`;

          const uploadResult = await uploadFile({
            key,
            buffer: drawing.buffer,
            contentType,
            fileName: sanitizedFileName,
          });

          // Generate thumbnail for PDFs
          let thumbnailS3Key: string | null = null;
          if (isPdfFile(contentType, drawing.fileName)) {
            try {
              const thumbnail = await generatePdfThumbnail(
                drawing.buffer,
                200,
                200
              );
              const thumbnailKey = `quote-parts/${quotePart.id}/drawings/${timestamp}-${randomString}-${sanitizedFileName}.thumb.png`;
              await uploadFile({
                key: thumbnailKey,
                buffer: thumbnail.buffer,
                contentType: "image/png",
                fileName: `${sanitizedFileName}.thumb.png`,
              });
              thumbnailS3Key = thumbnailKey;
            } catch (thumbnailError) {
              console.error(
                "Failed to generate PDF thumbnail:",
                thumbnailError
              );
            }
          }

          // Create attachment record
          if (!process.env.S3_BUCKET) {
            throw new Error("S3_BUCKET environment variable is not configured");
          }

          const [attachment] = await db
            .insert(attachments)
            .values({
              s3Bucket: process.env.S3_BUCKET,
              s3Key: uploadResult.key,
              fileName: drawing.fileName,
              contentType,
              fileSize: drawing.buffer.length,
              thumbnailS3Key,
            })
            .returning();

          // Link attachment to quote part
          await db.insert(quotePartDrawings).values({
            quotePartId: quotePart.id,
            attachmentId: attachment.id,
            version: 1,
          });
        }
      }

      await db.insert(quoteLineItems).values({
        quoteId: quote.id,
        quotePartId: quotePart.id,
        quantity: part.quantity,
        unitPrice: "0",
        totalPrice: "0",
        leadTimeDays: null,
        notes: part.notes || null,
        sortOrder: i,
      });

      await createEvent({
        entityType: "quote",
        entityId: quote.id.toString(),
        eventType: "quote_part_created",
        eventCategory: "document",
        title: "Quote Part Added",
        description: `Added part ${quotePart.partName} to quote`,
        metadata: {
          partName: quotePart.partName,
          quoteId: quote.id,
          material: part.material,
          tolerances: part.tolerances,
          surfaceFinish: part.surfaceFinish,
        },
        userId: context?.userId,
        userEmail: context?.userEmail,
      });
    }

    return { success: true, quoteId: quote.id };
  } catch (error) {
    console.error("Error creating quote with parts:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create quote",
    };
  }
}

export async function createQuotePart(
  quoteId: number,
  partData: {
    partNumber: string;
    partName: string;
    description?: string;
    material?: string;
    finish?: string;
    specifications?: Record<string, unknown> | null;
  },
  context?: QuoteEventContext
): Promise<QuotePart | null> {
  try {
    const [newPart] = await db
      .insert(quoteParts)
      .values({
        quoteId,
        ...partData,
      })
      .returning();

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: quoteId.toString(),
      eventType: "quote_part_added",
      eventCategory: "system",
      title: "Part Added to Quote",
      description: `Part ${partData.partNumber} - ${partData.partName} was added`,
      metadata: {
        partId: newPart.id,
        partNumber: partData.partNumber,
        partName: partData.partName,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return newPart;
  } catch (error) {
    console.error("Error creating quote part:", error);
    return null;
  }
}

export async function updateQuotePart(
  partId: string,
  updates: Partial<{
    partNumber: string;
    partName: string;
    description: string;
    material: string;
    finish: string;
    specifications: Record<string, unknown>;
  }>,
  context?: QuoteEventContext
): Promise<QuotePart | null> {
  try {
    const [updatedPart] = await db
      .update(quoteParts)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(quoteParts.id, partId))
      .returning();

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: updatedPart.quoteId.toString(),
      eventType: "quote_part_updated",
      eventCategory: "system",
      title: "Quote Part Updated",
      description: `Part ${updatedPart.partNumber} was updated`,
      metadata: {
        partId,
        updates,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return updatedPart;
  } catch (error) {
    console.error("Error updating quote part:", error);
    return null;
  }
}

export async function deleteQuotePart(
  partId: string,
  context?: QuoteEventContext
): Promise<boolean> {
  try {
    // Get part info before deletion
    const [part] = await db
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.id, partId));

    if (!part) {
      return false;
    }

    // Delete associated line items first
    await db
      .delete(quoteLineItems)
      .where(eq(quoteLineItems.quotePartId, partId));

    // Delete the part
    await db.delete(quoteParts).where(eq(quoteParts.id, partId));

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: part.quoteId.toString(),
      eventType: "quote_part_deleted",
      eventCategory: "system",
      title: "Quote Part Deleted",
      description: `Part ${part.partNumber} was deleted`,
      metadata: {
        partId,
        partNumber: part.partNumber,
        partName: part.partName,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return true;
  } catch (error) {
    console.error("Error deleting quote part:", error);
    return false;
  }
}

// Quote Line Items Management
export async function createQuoteLineItem(
  quoteId: number,
  itemData: {
    quotePartId?: string;
    name?: string;
    quantity: number;
    unitPrice: number;
    leadTimeDays?: number;
    description?: string;
    notes?: string;
    sortOrder?: number;
  },
  context?: QuoteEventContext
): Promise<QuoteLineItem | null> {
  try {
    const totalPrice = (itemData.quantity * itemData.unitPrice).toFixed(2);

    const [newItem] = await db
      .insert(quoteLineItems)
      .values({
        quoteId,
        quotePartId: itemData.quotePartId || null,
        name: itemData.name || null,
        quantity: itemData.quantity,
        unitPrice: itemData.unitPrice.toFixed(2),
        totalPrice,
        leadTimeDays: itemData.leadTimeDays || null,
        description: itemData.description || null,
        notes: itemData.notes || null,
        sortOrder: itemData.sortOrder || 0,
      })
      .returning();

    // Recalculate quote totals
    await calculateQuoteTotals(quoteId);

    // Get part name if applicable
    let partName = "Unknown Part";
    if (itemData.quotePartId) {
      const [quotePart] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, itemData.quotePartId))
        .limit(1);

      if (quotePart) {
        partName = quotePart.partName;
      }
    }

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: quoteId.toString(),
      eventType: "quote_line_item_added",
      eventCategory: "financial",
      title: "Line Item Added",
      description: `Added ${partName}`,
      metadata: {
        lineItemId: newItem.id,
        partName,
        quantity: itemData.quantity,
        unitPrice: itemData.unitPrice.toFixed(2),
        totalPrice: parseFloat(totalPrice).toFixed(2),
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return newItem;
  } catch (error) {
    console.error("Error creating quote line item:", error);
    return null;
  }
}

export async function updateQuoteLineItem(
  itemId: number,
  updates: Partial<{
    quantity: number;
    unitPrice: number;
    leadTimeDays: number;
    description: string;
    notes: string;
    sortOrder: number;
  }>,
  context?: QuoteEventContext
): Promise<QuoteLineItem | null> {
  try {
    // Get current item to get quoteId
    const [currentItem] = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.id, itemId));

    if (!currentItem) {
      return null;
    }

    // Calculate new total price if quantity or unit price changed
    const quantity = updates.quantity ?? currentItem.quantity;
    const unitPrice = updates.unitPrice ?? parseFloat(currentItem.unitPrice);
    const totalPrice = (quantity * unitPrice).toFixed(2);

    const [updatedItem] = await db
      .update(quoteLineItems)
      .set({
        ...updates,
        unitPrice: updates.unitPrice ? updates.unitPrice.toFixed(2) : undefined,
        totalPrice,
        updatedAt: new Date(),
      })
      .where(eq(quoteLineItems.id, itemId))
      .returning();

    // Recalculate quote totals
    await calculateQuoteTotals(currentItem.quoteId);

    // Get part name if applicable
    let partName = "Unknown Part";
    if (currentItem.quotePartId) {
      const [quotePart] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, currentItem.quotePartId))
        .limit(1);

      if (quotePart) {
        partName = quotePart.partName;
      }
    }

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: currentItem.quoteId.toString(),
      eventType: "quote_line_item_updated",
      eventCategory: "financial",
      title: "Line Item Updated",
      description: `Updated ${partName}`,
      metadata: {
        lineItemId: itemId,
        partName,
        updates,
        newTotalPrice: parseFloat(totalPrice).toFixed(2),
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return updatedItem;
  } catch (error) {
    console.error("Error updating quote line item:", error);
    return null;
  }
}

export async function deleteQuoteLineItem(
  itemId: number,
  context?: QuoteEventContext
): Promise<boolean> {
  try {
    // Get item info before deletion
    const [item] = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.id, itemId));

    if (!item) {
      return false;
    }

    // Delete the item
    await db.delete(quoteLineItems).where(eq(quoteLineItems.id, itemId));

    // Recalculate quote totals
    await calculateQuoteTotals(item.quoteId);

    // Get part name if applicable
    let partName = "Unknown Part";
    if (item.quotePartId) {
      const [quotePart] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, item.quotePartId))
        .limit(1);

      if (quotePart) {
        partName = quotePart.partName;
      }
    }

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: item.quoteId.toString(),
      eventType: "quote_line_item_deleted",
      eventCategory: "financial",
      title: "Line Item Deleted",
      description: `Deleted ${partName}`,
      metadata: {
        lineItemId: itemId,
        partName,
        quantity: item.quantity,
        totalPrice: parseFloat(item.totalPrice || "0").toFixed(2),
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    });

    return true;
  } catch (error) {
    console.error("Error deleting quote line item:", error);
    return false;
  }
}
