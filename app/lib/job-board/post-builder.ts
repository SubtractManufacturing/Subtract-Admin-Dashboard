import {
  DISCORD_MAX_FILES_PER_MESSAGE,
  DISCORD_MAX_POST_CHARS,
  type JobBoardAttachmentInput,
  type JobBoardOrderInput,
  type JobBoardPartInput,
  type JobBoardPlannedMessage,
  type JobBoardPostFile,
} from "./types";

export function isPostTextOverLimit(text: string): boolean {
  return text.length > DISCORD_MAX_POST_CHARS;
}

export function buildDefaultJobBoardPostText(order: JobBoardOrderInput): string {
  const lines: string[] = [];
  lines.push(`**Order ${order.orderNumber}**`);

  if (order.ndaRequired) {
    lines.push("");
    lines.push(
      "⚠️ **NDA required** — do not share this work on social media.",
    );
  }

  lines.push("");
  lines.push("**Parts**");
  for (const part of order.parts) {
    const name = part.partName?.trim() || "Unnamed part";
    lines.push(`• ${name} × ${part.quantity}`);
  }

  if (order.deliveryDate) {
    lines.push("");
    lines.push(
      `**Delivery:** ${order.deliveryDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`,
    );
  } else if (order.leadTime != null) {
    lines.push("");
    lines.push(`**Lead time:** ${order.leadTime} business days`);
  }

  return lines.join("\n");
}

function thumbnailFileName(part: JobBoardPartInput): string {
  const base = (part.partName?.trim() || part.partId).replace(
    /[^\w.-]+/g,
    "_",
  );
  return `${base}-thumbnail.png`;
}

function pushChunkedFileMessages(
  messages: JobBoardPlannedMessage[],
  group: JobBoardPlannedMessage["group"],
  files: JobBoardPostFile[],
) {
  if (files.length === 0) return;
  for (let i = 0; i < files.length; i += DISCORD_MAX_FILES_PER_MESSAGE) {
    messages.push({
      group,
      files: files.slice(i, i + DISCORD_MAX_FILES_PER_MESSAGE),
    });
  }
}

export function planJobBoardMessages(input: {
  postText: string;
  parts: JobBoardPartInput[];
  attachments: JobBoardAttachmentInput[];
  selectedAttachmentIds: string[];
}): JobBoardPlannedMessage[] {
  const messages: JobBoardPlannedMessage[] = [];

  messages.push({ group: "text", content: input.postText, files: [] });

  const thumbnailFiles: JobBoardPostFile[] = input.parts
    .filter((part) => part.thumbnailS3Key)
    .map((part) => ({
      fileName: thumbnailFileName(part),
      s3Key: part.thumbnailS3Key!,
      partId: part.partId,
    }));
  pushChunkedFileMessages(messages, "thumbnails", thumbnailFiles);

  const cadFiles: JobBoardPostFile[] = input.parts
    .filter((part) => part.currentCad)
    .map((part) => ({
      fileName: part.currentCad!.fileName,
      s3Key: part.currentCad!.s3Key,
      partId: part.partId,
    }));
  pushChunkedFileMessages(messages, "cad", cadFiles);

  const drawingFiles: JobBoardPostFile[] = input.parts.flatMap((part) =>
    part.drawings.map((drawing) => ({
      fileName: drawing.fileName,
      s3Key: drawing.s3Key,
      partId: part.partId,
      attachmentId: drawing.attachmentId,
    })),
  );
  pushChunkedFileMessages(messages, "drawings", drawingFiles);

  const selected = new Set(input.selectedAttachmentIds);
  const attachmentFiles: JobBoardPostFile[] = input.attachments
    .filter((attachment) => selected.has(attachment.attachmentId))
    .map((attachment) => ({
      fileName: attachment.fileName,
      s3Key: attachment.s3Key,
      attachmentId: attachment.attachmentId,
    }));
  pushChunkedFileMessages(messages, "attachments", attachmentFiles);

  return messages;
}

export function buildJobBoardPostPreview(input: {
  order: JobBoardOrderInput;
  postText?: string;
  selectedAttachmentIds?: string[];
}) {
  const postText = input.postText ?? buildDefaultJobBoardPostText(input.order);
  const selectedAttachmentIds = input.selectedAttachmentIds ?? [];
  const messages = planJobBoardMessages({
    postText,
    parts: input.order.parts,
    attachments: input.order.attachments,
    selectedAttachmentIds,
  });

  return {
    defaultText: buildDefaultJobBoardPostText(input.order),
    postText,
    textOverLimit: isPostTextOverLimit(postText),
    messages,
  };
}
