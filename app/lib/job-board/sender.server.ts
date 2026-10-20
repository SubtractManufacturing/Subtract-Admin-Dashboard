import { createEvent } from "../events";
import { updateOrder, type OrderEventContext } from "../orders";
import { downloadFile } from "../s3.server";
import type { DiscordWebhookClient } from "./discord-webhook";
import { isPostTextOverLimit, planJobBoardMessages } from "./post-builder";
import { flattenJobBoardThumbnailOnWhite } from "./thumbnail-post-process.server";
import type {
  JobBoardOrderInput,
  JobBoardPlannedMessage,
  JobBoardSentMessageRecord,
  PostedToJobBoardMetadata,
} from "./types";
import { JOB_BOARD_EVENT_TYPES } from "./types";
import { parseDiscordWebhookId } from "./webhook";

export type JobBoardSendProgress = {
  ok: true;
  sentMessages: JobBoardSentMessageRecord[];
} | {
  ok: false;
  failedGroup: JobBoardPlannedMessage["group"];
  failedMessageIndex: number;
  sentMessages: JobBoardSentMessageRecord[];
  error: string;
};

export async function sendJobBoardPost(params: {
  orderId: number;
  orderInput: JobBoardOrderInput;
  webhookUrl: string;
  postText: string;
  selectedAttachmentIds: string[];
  startAtMessageIndex: number;
  priorSentMessages?: JobBoardSentMessageRecord[];
  discord: DiscordWebhookClient;
  eventContext: OrderEventContext;
}): Promise<JobBoardSendProgress> {
  const {
    orderId,
    orderInput,
    webhookUrl,
    postText,
    selectedAttachmentIds,
    startAtMessageIndex,
    priorSentMessages = [],
    discord,
    eventContext,
  } = params;

  if (isPostTextOverLimit(postText)) {
    return {
      ok: false,
      failedGroup: "text",
      failedMessageIndex: 0,
      sentMessages: priorSentMessages,
      error: "Post text exceeds Discord's 2000-character limit",
    };
  }

  const planned = planJobBoardMessages({
    postText,
    parts: orderInput.parts,
    attachments: orderInput.attachments,
    selectedAttachmentIds,
  });

  const sentMessages: JobBoardSentMessageRecord[] = [...priorSentMessages];

  for (let index = startAtMessageIndex; index < planned.length; index += 1) {
    const message = planned[index];
    try {
      const files = await Promise.all(
        message.files.map(async (file) => {
          let data = await downloadFile(file.s3Key);
          if (message.group === "thumbnails") {
            data = await flattenJobBoardThumbnailOnWhite(data);
          }
          return {
            name: file.fileName,
            data,
          };
        }),
      );

      const result = await discord.executeWebhook(webhookUrl, {
        content: message.content,
        files: files.length > 0 ? files : undefined,
      });

      sentMessages.push({
        messageId: result.id,
        group: message.group,
        fileNames: message.files.map((file) => file.fileName),
      });
    } catch (error) {
      return {
        ok: false,
        failedGroup: message.group,
        failedMessageIndex: index,
        sentMessages,
        error: error instanceof Error ? error.message : "Discord send failed",
      };
    }
  }

  if (sentMessages.length !== planned.length) {
    return {
      ok: false,
      failedGroup: planned[startAtMessageIndex]?.group ?? "text",
      failedMessageIndex: startAtMessageIndex,
      sentMessages,
      error:
        "Send plan no longer matches the failed attempt. Close the modal and start a fresh send.",
    };
  }

  const webhookId = parseDiscordWebhookId(webhookUrl) ?? "unknown";
  const metadata: PostedToJobBoardMetadata = {
    webhookId,
    postText,
    messages: sentMessages,
  };

  await updateOrder(
    orderId,
    { status: "Waiting_For_Shop_Selection" },
    eventContext,
  );

  await createEvent({
    entityType: "order",
    entityId: orderId.toString(),
    eventType: JOB_BOARD_EVENT_TYPES.POSTED,
    eventCategory: "communication",
    title: "Posted to Job Board",
    description: `Order ${orderInput.orderNumber} posted to Discord Job Board`,
    metadata: {
      orderNumber: orderInput.orderNumber,
      ...metadata,
    },
    userId: eventContext.userId,
    userEmail: eventContext.userEmail,
  });

  return { ok: true, sentMessages };
}

export async function markJobBoardAsSent(params: {
  orderId: number;
  orderNumber: string;
  eventContext: OrderEventContext;
}) {
  const { orderId, orderNumber, eventContext } = params;

  await updateOrder(
    orderId,
    { status: "Waiting_For_Shop_Selection" },
    eventContext,
  );

  await createEvent({
    entityType: "order",
    entityId: orderId.toString(),
    eventType: JOB_BOARD_EVENT_TYPES.MARKED_AS_SENT,
    eventCategory: "communication",
    title: "Marked as sent to Job Board",
    description: `Order ${orderNumber} advanced without a Discord post`,
    metadata: { orderNumber },
    userId: eventContext.userId,
    userEmail: eventContext.userEmail,
  });
}
