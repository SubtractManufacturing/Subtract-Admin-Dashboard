import { db } from "./db";
import { developerSettings } from "./db/schema";
import { eq } from "drizzle-orm";

// Developer settings keys as constants
export const DEV_SETTINGS = {
  BANANA_CAD_URL: "banana_cad_url",
  BANANA_MESH_URL: "banana_mesh_url",
  BANANA_CONVERSION_STATUS: "banana_conversion_status",
  EMAIL_REPLY_TO_ADDRESS: "email_reply_to_address",
  EMAIL_OUTBOUND_BCC_ADDRESS: "email_outbound_bcc_address",
  EMAIL_INBOUND_FORWARD_ADDRESS: "email_inbound_forward_address",
} as const;

/**
 * Get a developer setting by key
 */
export async function getDeveloperSetting(key: string): Promise<string | null> {
  try {
    const result = await db
      .select()
      .from(developerSettings)
      .where(eq(developerSettings.key, key))
      .limit(1);
    
    return result[0]?.value ?? null;
  } catch (error) {
    console.error(`Error getting developer setting ${key}:`, error);
    return null;
  }
}

/**
 * Set a developer setting value
 */
export async function setDeveloperSetting(
  key: string,
  value: string | null,
  updatedBy?: string
): Promise<boolean> {
  try {
    // Check if setting exists
    const existing = await getDeveloperSetting(key);
    
    if (existing !== null) {
      // Update existing
      await db
        .update(developerSettings)
        .set({
          value,
          updatedAt: new Date(),
          updatedBy: updatedBy ?? null,
        })
        .where(eq(developerSettings.key, key));
    } else {
      // Insert new
      await db.insert(developerSettings).values({
        key,
        value,
        updatedBy: updatedBy ?? null,
      });
    }
    
    return true;
  } catch (error) {
    console.error(`Error setting developer setting ${key}:`, error);
    return false;
  }
}

/**
 * Get banana model URLs (CAD and mesh)
 */
export async function getBananaModelUrls(): Promise<{
  cadUrl: string | null;
  meshUrl: string | null;
  conversionStatus: string | null;
}> {
  const [cadUrl, meshUrl, conversionStatus] = await Promise.all([
    getDeveloperSetting(DEV_SETTINGS.BANANA_CAD_URL),
    getDeveloperSetting(DEV_SETTINGS.BANANA_MESH_URL),
    getDeveloperSetting(DEV_SETTINGS.BANANA_CONVERSION_STATUS),
  ]);
  
  return { cadUrl, meshUrl, conversionStatus };
}

/**
 * Set banana model URLs after upload/conversion
 */
export async function setBananaModelUrls(
  urls: {
    cadUrl?: string | null;
    meshUrl?: string | null;
    conversionStatus?: string | null;
  },
  updatedBy?: string
): Promise<boolean> {
  try {
    const updates: Promise<boolean>[] = [];
    
    if (urls.cadUrl !== undefined) {
      updates.push(setDeveloperSetting(DEV_SETTINGS.BANANA_CAD_URL, urls.cadUrl, updatedBy));
    }
    if (urls.meshUrl !== undefined) {
      updates.push(setDeveloperSetting(DEV_SETTINGS.BANANA_MESH_URL, urls.meshUrl, updatedBy));
    }
    if (urls.conversionStatus !== undefined) {
      updates.push(setDeveloperSetting(DEV_SETTINGS.BANANA_CONVERSION_STATUS, urls.conversionStatus, updatedBy));
    }
    
    const results = await Promise.all(updates);
    return results.every(Boolean);
  } catch (error) {
    console.error("Error setting banana model URLs:", error);
    return false;
  }
}

/**
 * Get the email reply-to address for Postmark inbound routing
 */
export async function getEmailReplyToAddress(): Promise<string | null> {
  return getDeveloperSetting(DEV_SETTINGS.EMAIL_REPLY_TO_ADDRESS);
}

/**
 * Set the email reply-to address for Postmark inbound routing
 */
export async function setEmailReplyToAddress(
  address: string | null,
  updatedBy?: string
): Promise<boolean> {
  return setDeveloperSetting(DEV_SETTINGS.EMAIL_REPLY_TO_ADDRESS, address, updatedBy);
}

/**
 * Get the outbound BCC address for Gmail mirroring (sent emails)
 */
export async function getEmailOutboundBccAddress(): Promise<string | null> {
  return getDeveloperSetting(DEV_SETTINGS.EMAIL_OUTBOUND_BCC_ADDRESS);
}

/**
 * Set the outbound BCC address for Gmail mirroring (sent emails)
 */
export async function setEmailOutboundBccAddress(
  address: string | null,
  updatedBy?: string
): Promise<boolean> {
  return setDeveloperSetting(DEV_SETTINGS.EMAIL_OUTBOUND_BCC_ADDRESS, address, updatedBy);
}

/**
 * Get the inbound forward address for Gmail mirroring (received emails)
 */
export async function getEmailInboundForwardAddress(): Promise<string | null> {
  return getDeveloperSetting(DEV_SETTINGS.EMAIL_INBOUND_FORWARD_ADDRESS);
}

/**
 * Set the inbound forward address for Gmail mirroring (received emails)
 */
export async function setEmailInboundForwardAddress(
  address: string | null,
  updatedBy?: string
): Promise<boolean> {
  return setDeveloperSetting(DEV_SETTINGS.EMAIL_INBOUND_FORWARD_ADDRESS, address, updatedBy);
}