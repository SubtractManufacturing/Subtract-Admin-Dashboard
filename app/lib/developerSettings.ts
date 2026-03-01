import { db } from "./db";
import { developerSettings } from "./db/schema";
import { eq, notInArray } from "drizzle-orm";

// Developer settings keys as constants
export const DEV_SETTINGS = {
  BANANA_CAD_URL: "banana_cad_url",
  BANANA_MESH_URL: "banana_mesh_url",
  BANANA_CONVERSION_STATUS: "banana_conversion_status",
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

export async function pruneStaleDeveloperSettings(): Promise<string[]> {
  const validKeys = Object.values(DEV_SETTINGS);
  const stale = await db
    .select({ key: developerSettings.key })
    .from(developerSettings)
    .where(notInArray(developerSettings.key, validKeys));

  if (stale.length === 0) return [];

  const staleKeys = stale.map(r => r.key);
  for (const key of staleKeys) {
    await db.delete(developerSettings).where(eq(developerSettings.key, key));
  }
  return staleKeys;
}
