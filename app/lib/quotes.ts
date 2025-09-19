import { db } from "./db/index.js"
import { quotes, customers, vendors } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { Customer, Vendor } from "./db/schema.js"
import { getNextQuoteNumber } from "./number-generator.js"
import { createEvent } from "./events.js"

export type QuoteWithRelations = {
  id: number
  quoteNumber: string
  customerId: number
  vendorId: number
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired'
  leadTime: 'Standard' | 'Expedited' | 'Custom' | null
  currency: 'USD' | 'EUR' | 'GBP' | 'CNY'
  totalPrice: string | null
  validUntil: Date | null
  createdAt: Date
  updatedAt: Date
  customer?: Customer | null
  vendor?: Vendor | null
}

export type QuoteInput = {
  customerId: number
  vendorId: number
  status?: 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired'
  leadTime?: 'Standard' | 'Expedited' | 'Custom' | null
  currency?: 'USD' | 'EUR' | 'GBP' | 'CNY'
  totalPrice?: string | null
  validUntil?: Date | null
}

export type QuoteEventContext = {
  userId?: string
  userEmail?: string
}

export async function getQuotesWithRelations(): Promise<QuoteWithRelations[]> {
  try {
    const result = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerId: quotes.customerId,
        vendorId: quotes.vendorId,
        status: quotes.status,
        leadTime: quotes.leadTime,
        currency: quotes.currency,
        totalPrice: quotes.totalPrice,
        validUntil: quotes.validUntil,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .where(eq(quotes.isArchived, false))
      .orderBy(desc(quotes.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching quotes:', error)
    return []
  }
}

export async function getQuote(id: number): Promise<QuoteWithRelations | null> {
  try {
    const result = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerId: quotes.customerId,
        vendorId: quotes.vendorId,
        status: quotes.status,
        leadTime: quotes.leadTime,
        currency: quotes.currency,
        totalPrice: quotes.totalPrice,
        validUntil: quotes.validUntil,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .where(eq(quotes.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get quote: ${error}`)
  }
}

export async function createQuote(quoteData: QuoteInput, eventContext?: QuoteEventContext): Promise<QuoteWithRelations> {
  try {
    const quoteNumber = await getNextQuoteNumber()
    
    const insertResult = await db
      .insert(quotes)
      .values({
        ...quoteData,
        quoteNumber
      })
      .returning()

    const newQuote = insertResult[0]

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: newQuote.id.toString(),
      eventType: "quote_created",
      eventCategory: "system",
      title: "Quote Created",
      description: `Created quote ${quoteNumber}`,
      metadata: {
        quoteNumber,
        customerId: quoteData.customerId,
        vendorId: quoteData.vendorId,
        status: quoteData.status,
        totalPrice: quoteData.totalPrice
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })

    const result = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerId: quotes.customerId,
        vendorId: quotes.vendorId,
        status: quotes.status,
        leadTime: quotes.leadTime,
        currency: quotes.currency,
        totalPrice: quotes.totalPrice,
        validUntil: quotes.validUntil,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .where(eq(quotes.id, newQuote.id))
      .limit(1)

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create quote: ${error}`)
  }
}

export async function updateQuote(id: number, quoteData: Partial<QuoteInput>, eventContext?: QuoteEventContext): Promise<QuoteWithRelations> {
  try {
    await db
      .update(quotes)
      .set(quoteData)
      .where(eq(quotes.id, id))

    // Log event
    await createEvent({
      entityType: "quote",
      entityId: id.toString(),
      eventType: "quote_updated",
      eventCategory: "system",
      title: "Quote Updated",
      description: `Updated quote`,
      metadata: {
        updatedFields: Object.keys(quoteData),
        ...quoteData
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })

    const result = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerId: quotes.customerId,
        vendorId: quotes.vendorId,
        status: quotes.status,
        leadTime: quotes.leadTime,
        currency: quotes.currency,
        totalPrice: quotes.totalPrice,
        validUntil: quotes.validUntil,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .where(eq(quotes.id, id))
      .limit(1)

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update quote: ${error}`)
  }
}

export async function deleteQuote(id: number, eventContext?: QuoteEventContext): Promise<void> {
  try {
    // Get quote details before deletion
    const quote = await getQuote(id)

    await db
      .delete(quotes)
      .where(eq(quotes.id, id))

    // Log event if quote existed
    if (quote) {
      await createEvent({
        entityType: "quote",
        entityId: id.toString(),
        eventType: "quote_deleted",
        eventCategory: "system",
        title: "Quote Deleted",
        description: `Deleted quote ${quote.quoteNumber}`,
        metadata: {
          quoteNumber: quote.quoteNumber,
          customerId: quote.customerId,
          vendorId: quote.vendorId
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
      })
    }
  } catch (error) {
    throw new Error(`Failed to delete quote: ${error}`)
  }
}

export async function archiveQuote(id: number, eventContext?: QuoteEventContext): Promise<void> {
  try {
    // Get quote details before archiving
    const quote = await getQuote(id)

    await db
      .update(quotes)
      .set({ isArchived: true })
      .where(eq(quotes.id, id))

    // Log event if quote existed
    if (quote) {
      await createEvent({
        entityType: "quote",
        entityId: id.toString(),
        eventType: "quote_archived",
        eventCategory: "system",
        title: "Quote Archived",
        description: `Archived quote ${quote.quoteNumber}`,
        metadata: {
          quoteNumber: quote.quoteNumber,
          customerId: quote.customerId,
          vendorId: quote.vendorId
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
      })
    }
  } catch (error) {
    throw new Error(`Failed to archive quote: ${error}`)
  }
}