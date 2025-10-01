import { db } from "./db/index.js"
import { quotes, customers, vendors, quoteLineItems, quoteParts, orders, orderLineItems, parts } from "./db/schema.js"
import { eq, desc, and, lte, isNull, sql } from 'drizzle-orm'
import type { Customer, Vendor, QuoteLineItem, QuotePart, Quote, NewQuote } from "./db/schema.js"
import { getNextQuoteNumber, getNextOrderNumber } from "./number-generator.js"
import { createEvent } from "./events.js"
import { uploadFile } from "./s3.server.js"
import { triggerQuotePartMeshConversion } from "./quote-part-mesh-converter.server.js"
import crypto from "crypto"

export type QuoteWithRelations = {
  id: number
  quoteNumber: string
  customerId: number
  vendorId: number | null
  status: 'RFQ' | 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Dropped' | 'Expired'
  validUntil: Date | null
  expirationDays: number | null
  sentAt: Date | null
  expiredAt: Date | null
  archivedAt: Date | null
  subtotal: string | null
  tax: string | null
  total: string | null
  notes: string | null
  termsAndConditions: string | null
  createdById: string | null
  convertedToOrderId: number | null
  rejectionReason: string | null
  currency: 'USD' | 'EUR' | 'GBP' | 'CNY'
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
  customer?: Customer | null
  vendor?: Vendor | null
  lineItems?: QuoteLineItem[]
  parts?: QuotePart[]
}

export type QuoteInput = {
  quoteNumber?: string | null
  customerId: number
  vendorId?: number | null
  status?: 'RFQ' | 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Dropped' | 'Expired'
  validUntil?: Date | null
  expirationDays?: number | null
  notes?: string | null
  termsAndConditions?: string | null
  currency?: 'USD' | 'EUR' | 'GBP' | 'CNY'
  rejectionReason?: string | null
  createdById?: string | null
}

export type QuoteEventContext = {
  userId?: string
  userEmail?: string
}

export async function getQuotes(includeArchived = false): Promise<QuoteWithRelations[]> {
  try {
    const quotesResult = await db
      .select()
      .from(quotes)
      .where(includeArchived ? sql`1=1` : eq(quotes.isArchived, false))
      .orderBy(desc(quotes.createdAt))

    if (!quotesResult.length) return []

    const quotesWithRelations = await Promise.all(
      quotesResult.map(async quote => {
        const [customer, vendor, lineItems, parts] = await Promise.all([
          quote.customerId
            ? db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1)
            : [null],
          quote.vendorId
            ? db.select().from(vendors).where(eq(vendors.id, quote.vendorId)).limit(1)
            : [null],
          db
            .select()
            .from(quoteLineItems)
            .where(eq(quoteLineItems.quoteId, quote.id))
            .orderBy(quoteLineItems.sortOrder),
          db
            .select()
            .from(quoteParts)
            .where(eq(quoteParts.quoteId, quote.id))
        ])

        return {
          ...quote,
          customer: customer[0],
          vendor: vendor[0],
          lineItems,
          parts
        }
      })
    )

    return quotesWithRelations
  } catch (error) {
    console.error('Error fetching quotes:', error)
    return []
  }
}

export async function getQuote(id: number): Promise<QuoteWithRelations | null> {
  try {
    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1)

    if (!quote) return null

    const [customer, vendor, lineItems, parts] = await Promise.all([
      quote.customerId
        ? db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1)
        : [null],
      quote.vendorId
        ? db.select().from(vendors).where(eq(vendors.id, quote.vendorId)).limit(1)
        : [null],
      db
        .select()
        .from(quoteLineItems)
        .where(eq(quoteLineItems.quoteId, quote.id))
        .orderBy(quoteLineItems.sortOrder),
      db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, quote.id))
    ])

    return {
      ...quote,
      customer: customer[0],
      vendor: vendor[0],
      lineItems,
      parts
    }
  } catch (error) {
    console.error('Error fetching quote:', error)
    return null
  }
}

export async function createQuote(
  input: QuoteInput,
  context?: QuoteEventContext
): Promise<Quote | null> {
  try {
    const quoteNumber = input.quoteNumber || await getNextQuoteNumber()

    const [newQuote] = await db
      .insert(quotes)
      .values({
        quoteNumber,
        customerId: input.customerId,
        vendorId: input.vendorId,
        status: input.status || 'RFQ',
        validUntil: input.validUntil,
        expirationDays: input.expirationDays,
        notes: input.notes,
        termsAndConditions: input.termsAndConditions,
        currency: input.currency || 'USD',
        createdById: input.createdById || context?.userId,
        rejectionReason: input.rejectionReason,
      })
      .returning()

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: newQuote.id.toString(),
      eventType: 'quote_created',
      eventCategory: 'system',
      title: 'Quote Created',
      description: `Quote ${quoteNumber} was created`,
      metadata: {
        quoteNumber,
        customerId: input.customerId,
        status: newQuote.status,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return newQuote
  } catch (error) {
    console.error('Error creating quote:', error)
    return null
  }
}

export async function updateQuote(
  id: number,
  updates: Partial<QuoteInput>,
  context?: QuoteEventContext
): Promise<Quote | null> {
  try {
    const oldQuote = await getQuote(id)
    if (!oldQuote) {
      throw new Error('Quote not found')
    }

    const updateData: Partial<Omit<NewQuote, 'quoteNumber'>> = {
      ...updates,
      updatedAt: new Date()
    }

    // Handle status transitions
    if (updates.status === 'Sent' && oldQuote.status !== 'Sent') {
      updateData.sentAt = new Date()

      // Calculate validUntil if not already set
      if (!updateData.validUntil) {
        const expirationDays = updates.expirationDays || oldQuote.expirationDays || 14
        const validUntil = new Date()
        validUntil.setDate(validUntil.getDate() + expirationDays)
        updateData.validUntil = validUntil
      }
    }

    if (updates.status === 'Expired' && oldQuote.status !== 'Expired') {
      updateData.expiredAt = new Date()
    }

    const [updatedQuote] = await db
      .update(quotes)
      .set(updateData)
      .where(eq(quotes.id, id))
      .returning()

    // Log status change events
    if (updates.status && updates.status !== oldQuote.status) {
      await createEvent({
        entityType: 'quote',
        entityId: id.toString(),
        eventType: 'quote_status_changed',
        eventCategory: 'status',
        title: 'Quote Status Updated',
        description: `Quote status changed from ${oldQuote.status} to ${updates.status}`,
        metadata: {
          oldStatus: oldQuote.status,
          newStatus: updates.status,
          quoteNumber: oldQuote.quoteNumber,
        },
        userId: context?.userId,
        userEmail: context?.userEmail,
      })
    }

    return updatedQuote
  } catch (error) {
    console.error('Error updating quote:', error)
    return null
  }
}

export async function archiveQuote(
  id: number,
  context?: QuoteEventContext
): Promise<boolean> {
  try {
    const quote = await getQuote(id)
    if (!quote) {
      throw new Error('Quote not found')
    }

    await db
      .update(quotes)
      .set({
        isArchived: true,
        archivedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(quotes.id, id))

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: id.toString(),
      eventType: 'quote_archived',
      eventCategory: 'system',
      title: 'Quote Archived',
      description: `Quote ${quote.quoteNumber} was archived`,
      metadata: {
        quoteNumber: quote.quoteNumber,
        previousStatus: quote.status,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return true
  } catch (error) {
    console.error('Error archiving quote:', error)
    return false
  }
}

export async function convertQuoteToOrder(
  quoteId: number,
  context?: QuoteEventContext
): Promise<{ success: boolean; orderId?: number; orderNumber?: string; error?: string }> {
  try {
    const quote = await getQuote(quoteId)
    if (!quote) {
      return { success: false, error: 'Quote not found' }
    }

    if (quote.status !== 'Accepted' && quote.status !== 'Sent') {
      return { success: false, error: 'Quote must be in Accepted or Sent status to convert' }
    }

    if (quote.convertedToOrderId) {
      return { success: false, error: 'Quote has already been converted to an order' }
    }

    // Start a transaction
    const result = await db.transaction(async (tx) => {
      // Create the order
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber: await getNextOrderNumber(),
          customerId: quote.customerId,
          vendorId: quote.vendorId,
          sourceQuoteId: quoteId,
          status: 'Pending',
          totalPrice: quote.total,
          notes: quote.notes,
        })
        .returning()

      // Update quote with converted order ID and status
      await tx
        .update(quotes)
        .set({
          convertedToOrderId: order.id,
          status: 'Accepted',
          updatedAt: new Date()
        })
        .where(eq(quotes.id, quoteId))

      // Convert quote parts to customer parts and create order line items
      if (quote.parts && quote.parts.length > 0) {
        for (const quotePart of quote.parts) {
          // Create a customer part from the quote part
          const [customerPart] = await tx
            .insert(parts)
            .values({
              customerId: quote.customerId,
              partName: quotePart.partName,
              material: quotePart.material || null,
              tolerance: quotePart.tolerance || null,
              finishing: quotePart.finish || null,
              thumbnailUrl: quotePart.thumbnailUrl || null,
              partFileUrl: quotePart.partFileUrl || null,
              partMeshUrl: quotePart.partMeshUrl || null,
              meshConversionStatus: quotePart.conversionStatus || 'pending',
              meshConversionError: quotePart.meshConversionError || null,
              meshConversionJobId: quotePart.meshConversionJobId || null,
              meshConversionStartedAt: quotePart.meshConversionStartedAt || null,
              meshConversionCompletedAt: quotePart.meshConversionCompletedAt || null,
              notes: quotePart.description || null,
            })
            .returning()

          // Find the corresponding line item for this quote part
          const lineItem = quote.lineItems?.find(li => li.quotePartId === quotePart.id)

          if (lineItem) {
            // Create order line item with reference to the new customer part
            await tx
              .insert(orderLineItems)
              .values({
                orderId: order.id,
                partId: customerPart.id,
                name: quotePart.partName,
                description: quotePart.description || lineItem.notes || '',
                quantity: lineItem.quantity,
                unitPrice: lineItem.unitPrice,
                notes: lineItem.notes,
              })
          }
        }
      } else if (quote.lineItems && quote.lineItems.length > 0) {
        // Fallback: if no parts exist, create simple line items
        await tx
          .insert(orderLineItems)
          .values(
            quote.lineItems.map(item => ({
              orderId: order.id,
              partId: null,
              name: `Part from quote ${quote.quoteNumber}`,
              description: item.notes || '',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              notes: item.notes,
            }))
          )
      }

      return { orderId: order.id, orderNumber: order.orderNumber }
    })

    // Log conversion event
    await createEvent({
      entityType: 'quote',
      entityId: quoteId.toString(),
      eventType: 'quote_converted',
      eventCategory: 'system',
      title: 'Quote Converted to Order',
      description: `Quote ${quote.quoteNumber} was converted to an order`,
      metadata: {
        quoteNumber: quote.quoteNumber,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return { success: true, orderId: result.orderId, orderNumber: result.orderNumber }
  } catch (error) {
    console.error('Error converting quote to order:', error)
    return { success: false, error: 'Failed to convert quote to order' }
  }
}

export async function calculateQuoteTotals(quoteId: number): Promise<{
  subtotal: number
  tax: number
  total: number
} | null> {
  try {
    const lineItems = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, quoteId))

    const subtotal = lineItems.reduce((sum, item) => {
      const totalPrice = parseFloat(item.totalPrice || '0')
      return sum + totalPrice
    }, 0)

    // Simple tax calculation (you may want to make this configurable)
    const taxRate = 0.08 // 8% tax
    const tax = subtotal * taxRate
    const total = subtotal + tax

    // Update the quote with calculated totals
    await db
      .update(quotes)
      .set({
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        total: total.toFixed(2),
        updatedAt: new Date()
      })
      .where(eq(quotes.id, quoteId))

    return { subtotal, tax, total }
  } catch (error) {
    console.error('Error calculating quote totals:', error)
    return null
  }
}

export async function checkAndUpdateExpiredQuotes(): Promise<number> {
  try {
    const now = new Date()

    // Find quotes that should be expired
    const expiredQuotes = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.status, 'Sent'),
          lte(quotes.validUntil, now),
          isNull(quotes.expiredAt)
        )
      )

    // Update each expired quote
    for (const quote of expiredQuotes) {
      await db
        .update(quotes)
        .set({
          status: 'Expired',
          expiredAt: now,
          updatedAt: now
        })
        .where(eq(quotes.id, quote.id))

      // Log expiration event
      await createEvent({
        entityType: 'quote',
        entityId: quote.id.toString(),
        eventType: 'quote_expired',
        eventCategory: 'system',
        title: 'Quote Expired',
        description: `Quote ${quote.quoteNumber} has expired`,
        metadata: {
          quoteNumber: quote.quoteNumber,
          validUntil: quote.validUntil,
        },
      })
    }

    return expiredQuotes.length
  } catch (error) {
    console.error('Error checking expired quotes:', error)
    return 0
  }
}

export async function createQuoteWithParts(
  quoteData: QuoteInput,
  partsData: Array<{
    file?: Buffer
    fileName?: string
    partName: string
    material?: string
    tolerances?: string
    surfaceFinish?: string
    quantity: number
    notes?: string
    drawings?: Array<{ buffer: Buffer; fileName: string }>
  }>,
  context?: QuoteEventContext
): Promise<{ success: boolean; quoteId?: number; error?: string }> {
  try {
    const quote = await createQuote(quoteData, context)
    if (!quote) {
      throw new Error('Failed to create quote')
    }

    for (let i = 0; i < partsData.length; i++) {
      const part = partsData[i]
      let partFileUrl: string | null = null

      if (part.file && part.fileName) {
        const timestamp = Date.now()
        const randomString = crypto.randomBytes(8).toString('hex')
        const extension = part.fileName.split('.').pop() || 'bin'
        const key = `quotes/${timestamp}-${randomString}.${extension}`

        const uploadResult = await uploadFile({
          key,
          buffer: part.file,
          contentType: 'application/octet-stream',
          fileName: part.fileName
        })
        partFileUrl = uploadResult.key
      }

      const [quotePart] = await db.insert(quoteParts).values({
        quoteId: quote.id,
        partName: part.partName || `Part ${i + 1}`,
        partNumber: `PART-${Date.now()}-${i}`,
        material: part.material || null,
        finish: part.surfaceFinish || null,
        tolerance: part.tolerances || null,
        partFileUrl,
        conversionStatus: 'pending',
        specifications: {
          tolerances: part.tolerances,
          notes: part.notes
        }
      }).returning()

      // Trigger mesh conversion if applicable
      if (partFileUrl) {
        await triggerQuotePartMeshConversion(quotePart.id, partFileUrl)
      }

      await db.insert(quoteLineItems).values({
        quoteId: quote.id,
        quotePartId: quotePart.id,
        quantity: part.quantity,
        unitPrice: '0',
        totalPrice: '0',
        leadTimeDays: null,
        notes: part.notes || null,
        sortOrder: i
      })

      await createEvent({
        entityType: 'quote',
        entityId: quote.id.toString(),
        eventType: 'quote_part_created',
        eventCategory: 'document',
        title: 'Quote Part Added',
        description: `Added part ${quotePart.partName} to quote`,
        metadata: {
          partName: quotePart.partName,
          quoteId: quote.id,
          material: part.material,
          tolerances: part.tolerances,
          surfaceFinish: part.surfaceFinish
        },
        userId: context?.userId,
        userEmail: context?.userEmail
      })
    }

    return { success: true, quoteId: quote.id }
  } catch (error) {
    console.error('Error creating quote with parts:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create quote'
    }
  }
}

export async function createQuotePart(
  quoteId: number,
  partData: {
    partNumber: string
    partName: string
    description?: string
    material?: string
    finish?: string
    specifications?: Record<string, unknown> | null
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
      .returning()

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: quoteId.toString(),
      eventType: 'quote_part_added',
      eventCategory: 'system',
      title: 'Part Added to Quote',
      description: `Part ${partData.partNumber} - ${partData.partName} was added`,
      metadata: {
        partId: newPart.id,
        partNumber: partData.partNumber,
        partName: partData.partName,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return newPart
  } catch (error) {
    console.error('Error creating quote part:', error)
    return null
  }
}

export async function updateQuotePart(
  partId: string,
  updates: Partial<{
    partNumber: string
    partName: string
    description: string
    material: string
    finish: string
    specifications: Record<string, unknown>
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
      .returning()

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: updatedPart.quoteId.toString(),
      eventType: 'quote_part_updated',
      eventCategory: 'system',
      title: 'Quote Part Updated',
      description: `Part ${updatedPart.partNumber} was updated`,
      metadata: {
        partId,
        updates,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return updatedPart
  } catch (error) {
    console.error('Error updating quote part:', error)
    return null
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
      .where(eq(quoteParts.id, partId))

    if (!part) {
      return false
    }

    // Delete associated line items first
    await db
      .delete(quoteLineItems)
      .where(eq(quoteLineItems.quotePartId, partId))

    // Delete the part
    await db
      .delete(quoteParts)
      .where(eq(quoteParts.id, partId))

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: part.quoteId.toString(),
      eventType: 'quote_part_deleted',
      eventCategory: 'system',
      title: 'Quote Part Deleted',
      description: `Part ${part.partNumber} was deleted`,
      metadata: {
        partId,
        partNumber: part.partNumber,
        partName: part.partName,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return true
  } catch (error) {
    console.error('Error deleting quote part:', error)
    return false
  }
}

// Quote Line Items Management
export async function createQuoteLineItem(
  quoteId: number,
  itemData: {
    quotePartId?: string
    quantity: number
    unitPrice: number
    leadTimeDays?: number
    notes?: string
    sortOrder?: number
  },
  context?: QuoteEventContext
): Promise<QuoteLineItem | null> {
  try {
    const totalPrice = (itemData.quantity * itemData.unitPrice).toFixed(2)

    const [newItem] = await db
      .insert(quoteLineItems)
      .values({
        quoteId,
        quotePartId: itemData.quotePartId || null,
        quantity: itemData.quantity,
        unitPrice: itemData.unitPrice.toFixed(2),
        totalPrice,
        leadTimeDays: itemData.leadTimeDays || null,
        notes: itemData.notes || null,
        sortOrder: itemData.sortOrder || 0,
      })
      .returning()

    // Recalculate quote totals
    await calculateQuoteTotals(quoteId)

    // Get part name if applicable
    let partName = 'Unknown Part'
    if (itemData.quotePartId) {
      const [quotePart] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, itemData.quotePartId))
        .limit(1)

      if (quotePart) {
        partName = quotePart.partName
      }
    }

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: quoteId.toString(),
      eventType: 'quote_line_item_added',
      eventCategory: 'financial',
      title: 'Line Item Added',
      description: `Added ${partName}`,
      metadata: {
        lineItemId: newItem.id,
        partName,
        quantity: itemData.quantity,
        unitPrice: itemData.unitPrice,
        totalPrice,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return newItem
  } catch (error) {
    console.error('Error creating quote line item:', error)
    return null
  }
}

export async function updateQuoteLineItem(
  itemId: number,
  updates: Partial<{
    quantity: number
    unitPrice: number
    leadTimeDays: number
    notes: string
    sortOrder: number
  }>,
  context?: QuoteEventContext
): Promise<QuoteLineItem | null> {
  try {
    // Get current item to get quoteId
    const [currentItem] = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.id, itemId))

    if (!currentItem) {
      return null
    }

    // Calculate new total price if quantity or unit price changed
    const quantity = updates.quantity ?? currentItem.quantity
    const unitPrice = updates.unitPrice ?? parseFloat(currentItem.unitPrice)
    const totalPrice = (quantity * unitPrice).toFixed(2)

    const [updatedItem] = await db
      .update(quoteLineItems)
      .set({
        ...updates,
        unitPrice: updates.unitPrice ? updates.unitPrice.toFixed(2) : undefined,
        totalPrice,
        updatedAt: new Date(),
      })
      .where(eq(quoteLineItems.id, itemId))
      .returning()

    // Recalculate quote totals
    await calculateQuoteTotals(currentItem.quoteId)

    // Get part name if applicable
    let partName = 'Unknown Part'
    if (currentItem.quotePartId) {
      const [quotePart] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, currentItem.quotePartId))
        .limit(1)

      if (quotePart) {
        partName = quotePart.partName
      }
    }

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: currentItem.quoteId.toString(),
      eventType: 'quote_line_item_updated',
      eventCategory: 'financial',
      title: 'Line Item Updated',
      description: `Updated ${partName}`,
      metadata: {
        lineItemId: itemId,
        partName,
        updates,
        newTotalPrice: totalPrice,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return updatedItem
  } catch (error) {
    console.error('Error updating quote line item:', error)
    return null
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
      .where(eq(quoteLineItems.id, itemId))

    if (!item) {
      return false
    }

    // Delete the item
    await db
      .delete(quoteLineItems)
      .where(eq(quoteLineItems.id, itemId))

    // Recalculate quote totals
    await calculateQuoteTotals(item.quoteId)

    // Get part name if applicable
    let partName = 'Unknown Part'
    if (item.quotePartId) {
      const [quotePart] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, item.quotePartId))
        .limit(1)

      if (quotePart) {
        partName = quotePart.partName
      }
    }

    // Log event
    await createEvent({
      entityType: 'quote',
      entityId: item.quoteId.toString(),
      eventType: 'quote_line_item_deleted',
      eventCategory: 'financial',
      title: 'Line Item Deleted',
      description: `Deleted ${partName}`,
      metadata: {
        lineItemId: itemId,
        partName,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
      },
      userId: context?.userId,
      userEmail: context?.userEmail,
    })

    return true
  } catch (error) {
    console.error('Error deleting quote line item:', error)
    return false
  }
}