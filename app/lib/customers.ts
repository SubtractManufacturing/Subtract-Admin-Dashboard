import { db } from "./db/index.js"
import { customers } from "./db/schema.js"
import { eq, desc, ne } from 'drizzle-orm'
import type { Customer, NewCustomer } from "./db/schema.js"

export type { Customer }

export type CustomerInput = {
  displayName: string
  email?: string | null
  phone?: string | null
}

export async function getCustomers(): Promise<Customer[]> {
  try {
    const result = await db
      .select()
      .from(customers)
      .where(eq(customers.isArchived, false))
      .orderBy(desc(customers.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching customers:', error)
    return []
  }
}

export async function getCustomer(id: number): Promise<Customer | null> {
  try {
    const result = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get customer: ${error}`)
  }
}

export async function createCustomer(customerData: CustomerInput): Promise<Customer> {
  try {
    const result = await db
      .insert(customers)
      .values(customerData)
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create customer: ${error}`)
  }
}

export async function updateCustomer(id: number, customerData: Partial<CustomerInput>): Promise<Customer> {
  try {
    const result = await db
      .update(customers)
      .set(customerData)
      .where(eq(customers.id, id))
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update customer: ${error}`)
  }
}

export async function deleteCustomer(id: number): Promise<void> {
  try {
    await db
      .delete(customers)
      .where(eq(customers.id, id))
  } catch (error) {
    throw new Error(`Failed to delete customer: ${error}`)
  }
}

export async function archiveCustomer(id: number): Promise<void> {
  try {
    await db
      .update(customers)
      .set({ isArchived: true })
      .where(eq(customers.id, id))
  } catch (error) {
    throw new Error(`Failed to archive customer: ${error}`)
  }
}