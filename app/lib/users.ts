import { db } from "./db";
import { users } from "./db/schema";
import { eq } from "drizzle-orm";

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

export async function ensureUserExists(userId: string, email: string, name?: string | null) {
  try {
    // Use upsert to avoid race conditions
    const result = await db
      .insert(users)
      .values({
        id: userId,
        email,
        name,
        role: "User", // Default role for new users
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email,
          name,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0].role;
  } catch (error) {
    // If insert still fails, fallback to reading existing user
    console.error('Error in ensureUserExists, falling back to read:', error);
    const existingUser = await getUserById(userId);
    return existingUser?.role || "User";
  }
}