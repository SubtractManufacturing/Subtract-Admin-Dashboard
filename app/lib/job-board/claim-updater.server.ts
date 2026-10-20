import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { eventLogs } from "../db/schema";
import { getVendor } from "../vendors";
import type { DiscordWebhookClient } from "./discord-webhook";
import { transformOpenPostToClaimed } from "./post-builder";
import {
  JOB_BOARD_EVENT_TYPES,
  type PostedToJobBoardMetadata,
} from "./types";

function isPostedMetadata(
  metadata: unknown,
): metadata is PostedToJobBoardMetadata & { orderNumber?: string } {
  if (!metadata || typeof metadata !== "object") return false;
  const record = metadata as Record<string, unknown>;
  return (
    typeof record.webhookId === "string" &&
    typeof record.postText === "string" &&
    Array.isArray(record.messages)
  );
}

export async function orderWasMarkedAsSentToJobBoard(
  orderId: number,
): Promise<boolean> {
  const [event] = await db
    .select({ id: eventLogs.id })
    .from(eventLogs)
    .where(
      and(
        eq(eventLogs.entityType, "order"),
        eq(eventLogs.entityId, orderId.toString()),
        eq(eventLogs.eventType, JOB_BOARD_EVENT_TYPES.MARKED_AS_SENT),
      ),
    )
    .limit(1);
  return Boolean(event);
}

export async function getLatestPostedToJobBoardEvent(orderId: number) {
  const [event] = await db
    .select()
    .from(eventLogs)
    .where(
      and(
        eq(eventLogs.entityType, "order"),
        eq(eventLogs.entityId, orderId.toString()),
        eq(eventLogs.eventType, JOB_BOARD_EVENT_TYPES.POSTED),
      ),
    )
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);
  return event ?? null;
}

export function buildClaimedPostText(
  originalPostText: string,
  vendor: { name: string; discordId: string | null },
): string {
  return transformOpenPostToClaimed(originalPostText, vendor);
}

export async function updateJobBoardClaim(params: {
  orderId: number;
  vendorId: number;
  webhookUrl: string | null;
  discord: DiscordWebhookClient;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  const { orderId, vendorId, webhookUrl, discord } = params;

  if (await orderWasMarkedAsSentToJobBoard(orderId)) {
    return { ok: true };
  }

  const postedEvent = await getLatestPostedToJobBoardEvent(orderId);
  if (!postedEvent || !isPostedMetadata(postedEvent.metadata)) {
    return { ok: true };
  }

  const editWebhookUrl =
    typeof postedEvent.metadata.webhookUrl === "string" &&
    postedEvent.metadata.webhookUrl.trim()
      ? postedEvent.metadata.webhookUrl
      : webhookUrl;

  if (!editWebhookUrl) {
    return {
      ok: false,
      warning: "Job Board webhook is not configured; Discord post was not updated.",
    };
  }

  const textMessage = postedEvent.metadata.messages.find(
    (message) => message.group === "text",
  );
  if (!textMessage) {
    return {
      ok: false,
      warning: "Could not find the Job Board text message to edit.",
    };
  }

  const vendor = await getVendor(vendorId);
  if (!vendor) {
    return {
      ok: false,
      warning: "Vendor not found; Discord post was not updated.",
    };
  }

  const vendorLabel =
    vendor.displayName?.trim() ||
    vendor.companyName?.trim() ||
    `Vendor #${vendor.id}`;

  const claimedText = buildClaimedPostText(
    postedEvent.metadata.postText,
    { name: vendorLabel, discordId: vendor.discordId },
  );

  try {
    await discord.editWebhookMessage(
      editWebhookUrl,
      textMessage.messageId,
      { content: claimedText },
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      warning:
        error instanceof Error
          ? `Discord claim update failed: ${error.message}`
          : "Discord claim update failed.",
    };
  }
}
