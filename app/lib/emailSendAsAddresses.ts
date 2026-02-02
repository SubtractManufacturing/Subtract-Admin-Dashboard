import { db } from "./db";
import { emailSendAsAddresses, type NewEmailSendAsAddress } from "./db/schema";
import { eq } from "drizzle-orm";

/**
 * Get all active "Send As" email addresses
 */
export async function getActiveSendAsAddresses() {
  const addresses = await db
    .select()
    .from(emailSendAsAddresses)
    .where(eq(emailSendAsAddresses.isActive, true))
    .orderBy(emailSendAsAddresses.isDefault, emailSendAsAddresses.label);
  
  return addresses;
}

/**
 * Get all "Send As" email addresses (including inactive)
 */
export async function getAllSendAsAddresses() {
  const addresses = await db
    .select()
    .from(emailSendAsAddresses)
    .orderBy(emailSendAsAddresses.isDefault, emailSendAsAddresses.label);
  
  return addresses;
}

/**
 * Add a new "Send As" email address
 */
export async function addSendAsAddress(
  email: string,
  label: string,
  createdBy?: string,
  replyToAddress?: string | null
) {
  // If this is the first address, make it the default
  const existingAddresses = await db.select().from(emailSendAsAddresses);
  const isDefault = existingAddresses.length === 0;

  const [newAddress] = await db
    .insert(emailSendAsAddresses)
    .values({
      email: email.toLowerCase().trim(),
      label: label.trim(),
      replyToAddress: replyToAddress?.trim() || null,
      isDefault,
      isActive: true,
      createdBy,
    })
    .returning();

  return newAddress;
}

/**
 * Update a "Send As" email address
 */
export async function updateSendAsAddress(
  id: number,
  updates: { email?: string; label?: string; isActive?: boolean; replyToAddress?: string | null }
) {
  const updateData: Partial<NewEmailSendAsAddress> = {
    updatedAt: new Date(),
  };

  if (updates.email !== undefined) {
    updateData.email = updates.email.toLowerCase().trim();
  }
  if (updates.label !== undefined) {
    updateData.label = updates.label.trim();
  }
  if (updates.isActive !== undefined) {
    updateData.isActive = updates.isActive;
  }
  if (updates.replyToAddress !== undefined) {
    updateData.replyToAddress = updates.replyToAddress?.trim() || null;
  }

  const [updated] = await db
    .update(emailSendAsAddresses)
    .set(updateData)
    .where(eq(emailSendAsAddresses.id, id))
    .returning();

  return updated;
}

/**
 * Set an address as the default
 */
export async function setDefaultSendAsAddress(id: number) {
  // First, unset all defaults
  await db
    .update(emailSendAsAddresses)
    .set({ isDefault: false, updatedAt: new Date() });

  // Then set the new default
  const [updated] = await db
    .update(emailSendAsAddresses)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(emailSendAsAddresses.id, id))
    .returning();

  return updated;
}

/**
 * Delete a "Send As" email address
 */
export async function deleteSendAsAddress(id: number) {
  // Check if this is the default address
  const [address] = await db
    .select()
    .from(emailSendAsAddresses)
    .where(eq(emailSendAsAddresses.id, id));

  if (!address) {
    return { success: false, error: "Address not found" };
  }

  await db
    .delete(emailSendAsAddresses)
    .where(eq(emailSendAsAddresses.id, id));

  // If the deleted address was the default, make the first remaining address the default
  if (address.isDefault) {
    const remaining = await db.select().from(emailSendAsAddresses).limit(1);
    if (remaining.length > 0) {
      await db
        .update(emailSendAsAddresses)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(emailSendAsAddresses.id, remaining[0].id));
    }
  }

  return { success: true };
}

/**
 * Check if an email address already exists
 */
export async function sendAsAddressExists(email: string) {
  const [existing] = await db
    .select()
    .from(emailSendAsAddresses)
    .where(eq(emailSendAsAddresses.email, email.toLowerCase().trim()))
    .limit(1);

  return !!existing;
}

/**
 * Get a Send As address by email
 */
export async function getSendAsAddressByEmail(email: string) {
  const [address] = await db
    .select()
    .from(emailSendAsAddresses)
    .where(eq(emailSendAsAddresses.email, email.toLowerCase().trim()))
    .limit(1);

  return address || null;
}

