import { db } from "./db";
import { users, type User } from "./db/schema";
import { createEvent } from "./events";
import { desc, eq, sql } from "drizzle-orm";

export interface UserEventContext {
  userId: string;
  userEmail: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function getUserRole(userId: string) {
  const result = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  return result[0]?.role || "User";
}

export async function getUserById(userId: string) {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  return result[0];
}

export async function getAllUsers() {
  return await db
    .select()
    .from(users)
    .where(eq(users.isArchived, false))
    .orderBy(desc(users.createdAt));
}

export async function ensureUserExists(
  userId: string,
  email: string,
  name?: string | null
): Promise<{ role: User["role"]; status: User["status"]; isArchived: boolean }> {
  try {
    // Use upsert to avoid race conditions
    const result = await db
      .insert(users)
      .values({
        id: userId,
        email,
        name,
        role: "User", // Default role for new users
        status: "active",
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email,
          name,
          status: sql`CASE WHEN ${users.status} = 'pending' THEN 'active' ELSE ${users.status} END`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      role: result[0].role,
      status: result[0].status,
      isArchived: result[0].isArchived,
    };
  } catch (error) {
    // If upsert still fails, fallback to reading existing user (e.g. timeout, race)
    console.error("Error in ensureUserExists, falling back to read:", error);
    try {
      const existingUser = await getUserById(userId);
      return {
        role: existingUser?.role || "User",
        status: existingUser?.status || "active",
        isArchived: existingUser?.isArchived || false,
      };
    } catch (readError) {
      console.error("ensureUserExists fallback read failed:", readError);
      throw new Error(
        "Could not reach the database to verify your account (timeout or connection error). Check DATABASE_URL, VPN, and that Postgres is reachable.",
        { cause: readError },
      );
    }
  }
}

export async function updateUserRole(
  targetUserId: string,
  newRole: User["role"],
  ctx: UserEventContext
) {
  const target = await getUserById(targetUserId);
  if (!target) throw new Error("User not found");

  const oldRole = target.role;
  const [updated] = await db
    .update(users)
    .set({ role: newRole, updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();

  await createEvent({
    entityType: "user",
    entityId: targetUserId,
    eventType: "user.role_changed",
    eventCategory: "system",
    title: `Role changed: ${target.email}`,
    description: `${ctx.userEmail} changed ${target.email} from ${oldRole} to ${newRole}`,
    metadata: { from: oldRole, to: newRole, targetEmail: target.email },
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return updated;
}

export async function disableUser(targetUserId: string, ctx: UserEventContext) {
  const target = await getUserById(targetUserId);
  if (!target) throw new Error("User not found");

  const [updated] = await db
    .update(users)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();

  await createEvent({
    entityType: "user",
    entityId: targetUserId,
    eventType: "user.disabled",
    eventCategory: "system",
    title: `User disabled: ${target.email}`,
    description: `${ctx.userEmail} disabled ${target.email}`,
    metadata: { targetEmail: target.email },
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return updated;
}

export async function enableUser(targetUserId: string, ctx: UserEventContext) {
  const target = await getUserById(targetUserId);
  if (!target) throw new Error("User not found");

  const [updated] = await db
    .update(users)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();

  await createEvent({
    entityType: "user",
    entityId: targetUserId,
    eventType: "user.enabled",
    eventCategory: "system",
    title: `User re-enabled: ${target.email}`,
    description: `${ctx.userEmail} re-enabled ${target.email}`,
    metadata: { targetEmail: target.email },
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return updated;
}