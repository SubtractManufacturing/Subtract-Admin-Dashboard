import { db } from "./db";
import { featureFlags, type NewFeatureFlag } from "./db/schema";
import { eq } from "drizzle-orm";

// Feature flag keys as constants
export const FEATURE_FLAGS = {
  MESH_UPLOADS_DEV: "mesh_uploads_dev",
  MESH_UPLOADS_ALL: "mesh_uploads_all",
  EVENTS_ACCESS_ALL: "events_access_all",
  EVENTS_NAV_VISIBLE: "events_nav_visible",
  PRICE_CALCULATOR_DEV: "price_calculator_dev",
  PRICE_CALCULATOR_ALL: "price_calculator_all",
} as const;

// Default feature flags with their metadata
const DEFAULT_FLAGS: Array<Omit<NewFeatureFlag, "id" | "createdAt" | "updatedAt">> = [
  {
    key: FEATURE_FLAGS.MESH_UPLOADS_DEV,
    name: "Enable Mesh Uploads for Developers",
    description: "Allow users with Developer role to upload 3D mesh files (STL, OBJ, GLTF)",
    enabled: false,
  },
  {
    key: FEATURE_FLAGS.MESH_UPLOADS_ALL,
    name: "Enable Mesh Uploads for All Users",
    description: "Allow all users to upload 3D mesh files (STL, OBJ, GLTF)",
    enabled: false,
  },
  {
    key: FEATURE_FLAGS.EVENTS_ACCESS_ALL,
    name: "Enable Events Route for All Users",
    description: "Allow all users to access the /events route (Admin and Dev users always have access)",
    enabled: true,
  },
  {
    key: FEATURE_FLAGS.EVENTS_NAV_VISIBLE,
    name: "Show Events in Navigation",
    description: "Display the Events link in the navigation bar for all users",
    enabled: true,
  },
  {
    key: FEATURE_FLAGS.PRICE_CALCULATOR_DEV,
    name: "Enable Price Calculator for Admins/Devs",
    description: "Allow users with Admin or Developer role to access the quote price calculator",
    enabled: true,
  },
  {
    key: FEATURE_FLAGS.PRICE_CALCULATOR_ALL,
    name: "Enable Price Calculator for All Users",
    description: "Allow all users to access the quote price calculator",
    enabled: false,
  },
];

export async function getAllFeatureFlags() {
  const flags = await db.select().from(featureFlags);
  return flags;
}

export async function getFeatureFlag(key: string) {
  const result = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);
  
  return result[0];
}

export async function updateFeatureFlag(key: string, enabled: boolean, updatedBy: string) {
  const result = await db
    .update(featureFlags)
    .set({
      enabled,
      updatedBy,
      updatedAt: new Date(),
    })
    .where(eq(featureFlags.key, key))
    .returning();
  
  return result[0];
}

export async function initializeFeatureFlags() {
  // Check if feature flags exist, if not create them
  for (const flag of DEFAULT_FLAGS) {
    const existing = await getFeatureFlag(flag.key);
    if (!existing) {
      await db.insert(featureFlags).values(flag);
    }
  }
}

export async function isFeatureEnabled(key: string) {
  let flag = await getFeatureFlag(key);

  // If flag doesn't exist, create it with default value
  if (!flag) {
    const defaultFlag = DEFAULT_FLAGS.find(f => f.key === key);
    if (defaultFlag) {
      try {
        await db.insert(featureFlags).values(defaultFlag);
        flag = await getFeatureFlag(key);
      } catch (error) {
        // If insert fails (e.g., race condition), try to fetch again
        flag = await getFeatureFlag(key);
      }
    }
  }

  return flag?.enabled || false;
}

export async function canUserUploadMesh(userRole?: string | null) {
  // Check if mesh uploads are enabled for all users
  const allUsersEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESH_UPLOADS_ALL);
  if (allUsersEnabled) return true;

  // Check if mesh uploads are enabled for developers and user is a developer
  if (userRole === "Dev") {
    const devEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESH_UPLOADS_DEV);
    return devEnabled;
  }

  return false;
}

export async function canUserAccessEvents(userRole?: string | null) {
  // Admin and Dev users always have access
  if (userRole === "Admin" || userRole === "Dev") {
    return true;
  }

  // For other users, check the feature flag
  const eventsEnabled = await isFeatureEnabled(FEATURE_FLAGS.EVENTS_ACCESS_ALL);
  return eventsEnabled;
}

export async function shouldShowEventsInNav() {
  // Check if events should be shown in navigation
  const navVisible = await isFeatureEnabled(FEATURE_FLAGS.EVENTS_NAV_VISIBLE);
  return navVisible;
}

export async function canUserAccessPriceCalculator(userRole?: string | null) {
  // Check if price calculator is enabled for all users
  const allUsersEnabled = await isFeatureEnabled(FEATURE_FLAGS.PRICE_CALCULATOR_ALL);
  if (allUsersEnabled) return true;

  // Check if price calculator is enabled for admins/devs and user has elevated role
  if (userRole === "Admin" || userRole === "Dev") {
    const devEnabled = await isFeatureEnabled(FEATURE_FLAGS.PRICE_CALCULATOR_DEV);
    return devEnabled;
  }

  return false;
}