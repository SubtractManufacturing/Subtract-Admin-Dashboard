import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { createEvent } from "./events";
import { createAdminClient } from "./supabase.admin.server";
import { getUserById, type UserEventContext } from "./users";

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

  // The staff gate refuses anyone without a users row, so an invite whose row
  // cannot be saved would be unusable. Roll the auth user back instead.
  try {
    await db
      .insert(users)
      .values({
        id: authUser.id,
        email,
        role: "User",
        status: "pending",
      })
      .onConflictDoNothing();
  } catch (insertError) {
    console.error("inviteUser: could not save pending user, rolling back:", insertError);
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(
      authUser.id,
    );
    if (rollbackError) {
      console.error("inviteUser: rollback failed:", rollbackError);
    }
    throw new Error("Invite failed: could not save the user. Please try again.", {
      cause: insertError,
    });
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
