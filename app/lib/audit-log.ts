import { db } from "./db";
import { loginAuditLogs, type NewLoginAuditLog } from "./db/schema";
import { desc, eq, and, gte } from "drizzle-orm";

export async function createLoginAuditLog(data: Omit<NewLoginAuditLog, "id" | "createdAt">) {
  try {
    const [log] = await db.insert(loginAuditLogs).values(data).returning();
    return log;
  } catch (error) {
    // Log error but don't throw - audit logs should not break authentication
    console.error("Failed to create audit log:", error);
    return null;
  }
}

export async function getLoginAuditLogs(options?: {
  limit?: number;
  offset?: number;
  userId?: string;
  email?: string;
}) {
  const query = db.select().from(loginAuditLogs);
  
  // Apply filters if provided
  const conditions: ReturnType<typeof eq>[] = [];
  if (options?.userId) {
    conditions.push(eq(loginAuditLogs.userId, options.userId));
  }
  if (options?.email) {
    conditions.push(eq(loginAuditLogs.email, options.email));
  }
  
  // Apply conditions if any
  if (conditions.length > 0) {
    query.where(and(...conditions));
  }
  
  // Apply ordering and pagination
  query.orderBy(desc(loginAuditLogs.createdAt));
  
  if (options?.limit) {
    query.limit(options.limit);
  }
  if (options?.offset) {
    query.offset(options.offset);
  }
  
  return await query;
}

export async function getRecentFailedLogins(email: string, minutes: number = 60) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  
  return await db
    .select()
    .from(loginAuditLogs)
    .where(
      and(
        eq(loginAuditLogs.email, email),
        eq(loginAuditLogs.success, false),
        gte(loginAuditLogs.createdAt, since)
      )
    )
    .orderBy(desc(loginAuditLogs.createdAt));
}