import { db } from "./db";
import { users, type NewUser } from "./db/schema";
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
  // Check if user already exists in public.users
  const existingUser = await getUserById(userId);
  
  if (existingUser) {
    // Update user info if it changed
    if (existingUser.email !== email || existingUser.name !== name) {
      await db
        .update(users)
        .set({
          email,
          name,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }
    return existingUser.role;
  }
  
  // Create new user record
  const newUser: NewUser = {
    id: userId,
    email,
    name,
    role: "User", // Default role for new users
  };
  
  await db.insert(users).values(newUser);
  return "User";
}