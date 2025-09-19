import { db } from "./db";
import { featureFlags, type NewFeatureFlag } from "./db/schema";
import { eq } from "drizzle-orm";

// Feature flag keys as constants
export const FEATURE_FLAGS = {
  MESH_UPLOADS_DEV: "mesh_uploads_dev",
  MESH_UPLOADS_ALL: "mesh_uploads_all",
  EVENTS_ACCESS_ALL: "events_access_all",
  EVENTS_NAV_VISIBLE: "events_nav_visible",
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
  const flag = await getFeatureFlag(key);
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