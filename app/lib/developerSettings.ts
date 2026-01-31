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
  
  // Reconciliation settings
  // Postmark reconciliation
  RECONCILIATION_POSTMARK_ENABLED: "reconciliation_postmark_enabled",
  RECONCILIATION_POSTMARK_CRON: "reconciliation_postmark_cron",
  RECONCILIATION_POSTMARK_WINDOW_HOURS: "reconciliation_postmark_window_hours",
  
  // Future: Stripe reconciliation
  // RECONCILIATION_STRIPE_ENABLED: "reconciliation_stripe_enabled",
  // RECONCILIATION_STRIPE_CRON: "reconciliation_stripe_cron",
  // RECONCILIATION_STRIPE_WINDOW_HOURS: "reconciliation_stripe_window_hours",
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

// ============================================
// Reconciliation Settings
// ============================================

/**
 * Reconciliation task configuration
 */
export interface ReconciliationTaskConfig {
  enabled: boolean;
  cron: string;
  windowHours: number;
}

/**
 * Get reconciliation configuration for a specific task
 */
export async function getReconciliationTaskConfig(
  taskId: string
): Promise<ReconciliationTaskConfig> {
  const [enabled, cron, windowHours] = await Promise.all([
    getDeveloperSetting(`reconciliation_${taskId}_enabled`),
    getDeveloperSetting(`reconciliation_${taskId}_cron`),
    getDeveloperSetting(`reconciliation_${taskId}_window_hours`),
  ]);

  return {
    enabled: enabled === "true",
    cron: cron || "0 */6 * * *", // Default: every 6 hours
    windowHours: windowHours ? parseInt(windowHours) : 72, // Default: 72 hours
  };
}

/**
 * Set reconciliation configuration for a specific task
 */
export async function setReconciliationTaskConfig(
  taskId: string,
  config: Partial<ReconciliationTaskConfig>,
  updatedBy?: string
): Promise<boolean> {
  try {
    const updates: Promise<boolean>[] = [];

    if (config.enabled !== undefined) {
      updates.push(
        setDeveloperSetting(
          `reconciliation_${taskId}_enabled`,
          config.enabled ? "true" : "false",
          updatedBy
        )
      );
    }
    if (config.cron !== undefined) {
      updates.push(
        setDeveloperSetting(
          `reconciliation_${taskId}_cron`,
          config.cron,
          updatedBy
        )
      );
    }
    if (config.windowHours !== undefined) {
      updates.push(
        setDeveloperSetting(
          `reconciliation_${taskId}_window_hours`,
          String(config.windowHours),
          updatedBy
        )
      );
    }

    const results = await Promise.all(updates);
    return results.every(Boolean);
  } catch (error) {
    console.error(`Error setting reconciliation config for ${taskId}:`, error);
    return false;
  }
}

/**
 * Get Postmark reconciliation configuration
 */
export async function getPostmarkReconciliationConfig(): Promise<ReconciliationTaskConfig> {
  return getReconciliationTaskConfig("postmark");
}

/**
 * Set Postmark reconciliation configuration
 */
export async function setPostmarkReconciliationConfig(
  config: Partial<ReconciliationTaskConfig>,
  updatedBy?: string
): Promise<boolean> {
  return setReconciliationTaskConfig("postmark", config, updatedBy);
}