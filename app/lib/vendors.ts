import { db } from "./db/index.js"
import { vendors } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { Vendor, NewVendor } from "./db/schema.js"

export type { Vendor }

export type VendorInput = {
  displayName: string
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
  discordId?: string | null
}

export async function getVendors(): Promise<Vendor[]> {
  try {
    const result = await db
      .select()
      .from(vendors)
      .where(eq(vendors.isArchived, false))
      .orderBy(desc(vendors.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching vendors:', error)
    return []
  }
}

export async function getVendor(id: number): Promise<Vendor | null> {
  try {
    const result = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get vendor: ${error}`)
  }
}

export async function createVendor(vendorData: VendorInput): Promise<Vendor> {
  try {
    const result = await db
      .insert(vendors)
      .values(vendorData)
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create vendor: ${error}`)
  }
}

export async function updateVendor(id: number, vendorData: Partial<VendorInput>): Promise<Vendor> {
  try {
    const result = await db
      .update(vendors)
      .set(vendorData)
      .where(eq(vendors.id, id))
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update vendor: ${error}`)
  }
}

export async function deleteVendor(id: number): Promise<void> {
  try {
    await db
      .delete(vendors)
      .where(eq(vendors.id, id))
  } catch (error) {
    throw new Error(`Failed to delete vendor: ${error}`)
  }
}

export async function archiveVendor(id: number): Promise<void> {
  try {
    await db
      .update(vendors)
      .set({ isArchived: true })
      .where(eq(vendors.id, id))
  } catch (error) {
    throw new Error(`Failed to archive vendor: ${error}`)
  }
}