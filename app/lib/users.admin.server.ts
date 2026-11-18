import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { createEvent } from "./events";
import { createAdminClient } from "./supabase.admin.server";
import { getUserById, type UserEventContext } from "./users";

function insertPendingUser(values: typeof users.$inferInsert) {
  return db.insert(users).values(values).onConflictDoNothing();
}

export async function inviteUser(
  email: string,
  redirectTo: string,
  ctx: UserEventContext
) {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { redirectTo }
  );

  if (error) {
    if (error.status === 429 || error.message?.toLowerCase().includes("rate")) {
      throw new Error("Too many invites sent. Please wait before trying again.");
    }
    throw new Error(`Invite failed: ${error.message}`);
  }

  const authUser = data.user;
  if (!authUser) {
    throw new Error("Invite failed: user was not returned");
  }

  // The staff gate refuses anyone without a users row, so the row must be
  // saved. Retry once for transient errors. Never delete the auth user on
  // failure: inviteUserByEmail can return an existing identity, so we cannot
  // prove this call created it. Inviting again is idempotent and repairs the row.
  const pendingUser = {
    id: authUser.id,
    email,
    role: "User" as const,
    status: "pending" as const,
  };
  try {
    await insertPendingUser(pendingUser);
  } catch (firstError) {
    console.error("inviteUser: pending user insert failed, retrying:", firstError);
    try {
      await insertPendingUser(pendingUser);
    } catch (insertError) {
      console.error("inviteUser: could not save pending user:", insertError, {
        authUserId: authUser.id,
      });
      throw new Error(
        "Invite email was sent but the user could not be saved. Please invite the user again.",
        { cause: insertError },
      );
    }
  }

  await createEvent({
    entityType: "user",
    entityId: authUser.id,
    eventType: "user.invited",
    eventCategory: "system",
    title: `User invited: ${email}`,
    description: `${ctx.userEmail} invited ${email}`,
    metadata: { invitedEmail: email },
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return authUser;
}

export async function deleteUser(targetUserId: string, ctx: UserEventContext) {
  const target = await getUserById(targetUserId);
  if (!target) throw new Error("User not found");

  const adminClient = createAdminClient();
  const { error } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (error) throw new Error(`Auth delete failed: ${error.message}`);

  const [archived] = await db
    .update(users)
    .set({
      isArchived: true,
      status: "disabled",
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetUserId))
    .returning();

  await createEvent({
    entityType: "user",
    entityId: targetUserId,
    eventType: "user.deleted",
    eventCategory: "system",
    title: `User deleted: ${target.email}`,
    description: `${ctx.userEmail} permanently deleted ${target.email}`,
    metadata: { targetEmail: target.email, targetRole: target.role },
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return archived;
}
