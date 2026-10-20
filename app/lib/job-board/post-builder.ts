import { jobBoardDiscordFileName } from "./file-names";
import { formatJobBoardNotifyRoleMention } from "./webhook";
import {
  DISCORD_MAX_FILES_PER_MESSAGE,
  DISCORD_MAX_POST_CHARS,
  type JobBoardAttachmentInput,
  type JobBoardOrderInput,
  type JobBoardPartInput,
  type JobBoardPlannedMessage,
  type JobBoardPostFile,
} from "./types";

export const JOB_BOARD_POST_HEADER = "# New Job Availability:";
/** Plain-title posts from an earlier template revision. */
export const LEGACY_JOB_BOARD_POST_HEADER = "New Job Availability:";
export const JOB_BOARD_POST_DIVIDER = "----------";

export type JobBoardPostTextOptions = {
  notifyRoleId?: string | null;
};

export type JobBoardClaimVendor = {
  name: string;
  discordId: string | null;
};

export function isPostTextOverLimit(text: string): boolean {
  return text.length > DISCORD_MAX_POST_CHARS;
}

function formatJobBoardDeliveryDate(
  value: JobBoardOrderInput["deliveryDate"],
): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShopPay(amount: string | null | undefined): string | null {
  if (amount == null || amount.trim() === "") return null;
  const parsed = Number.parseFloat(amount);
  if (Number.isNaN(parsed)) return null;
  return parsed.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function partFinishLabel(part: JobBoardPartInput): string {
  return normalizeText(part.finishing) ?? "As Machined";
}

function jobNumberLine(order: JobBoardOrderInput): string {
  const suffix = order.ndaRequired ? " - NDA" : "";
  return `**Job Number:** ${order.orderNumber}${suffix}`;
}

function buildPartSection(part: JobBoardPartInput): string[] {
  const lines: string[] = [];
  const name = normalizeText(part.partName) ?? "Unnamed part";
  lines.push(`**Part Name:** ${name}`);
  lines.push(`**Quantity:** ${part.quantity}`);

  const material = normalizeText(part.material);
  if (material) lines.push(`**Material:** ${material}`);

  if (part.approxSize) {
    lines.push(`**Approx Size:** ${part.approxSize}`);
  }

  lines.push(`**Finish:** ${partFinishLabel(part)}`);

  const tolerance = normalizeText(part.tolerance);
  if (tolerance) lines.push(`**Tolerance:** ${tolerance}`);

  return lines;
}

export function buildJobBoardPostBody(order: JobBoardOrderInput): string {
  const lines: string[] = [];
  lines.push(jobNumberLine(order));

  if (order.ndaRequired) {
    lines.push("");
    lines.push(
      "⚠️ **NDA required** — do not share this work on social media.",
    );
  }

  for (const part of order.parts) {
    lines.push("");
    lines.push(...buildPartSection(part));
  }

  lines.push("");
  const shopPay = formatShopPay(order.shopPay);
  if (shopPay) {
    lines.push(`**Shop Pay:** ${shopPay}`);
  }

  const deliveryLabel = formatJobBoardDeliveryDate(order.deliveryDate);
  if (deliveryLabel) {
    lines.push("");
    lines.push(`**Lead Time:** Delivered ${deliveryLabel}`);
  } else if (order.leadTime != null) {
    lines.push("");
    lines.push(
      `**Lead Time:** ${order.leadTime} business days from acceptance`,
    );
  }

  const generalNotes = normalizeText(order.generalNotes);
  if (generalNotes) {
    lines.push("");
    lines.push(`**General Notes:** ${generalNotes}`);
  }

  return lines.join("\n");
}

function isDiscordPingLine(line: string): boolean {
  const trimmed = line.trim();
  return /^<@&?\d+>$/.test(trimmed);
}

function isRoleOrClaimLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isDiscordPingLine(trimmed)) return true;
  return /^Claimed by .+$/i.test(trimmed);
}

function buildHeaderBlock(pingOrClaimLine: string | null): string[] {
  const block = [JOB_BOARD_POST_HEADER];
  if (pingOrClaimLine) {
    block.push(pingOrClaimLine);
  }
  block.push(JOB_BOARD_POST_DIVIDER, "");
  return block;
}

function isJobBoardPostHeaderLine(line: string | undefined): boolean {
  const trimmed = line?.trim();
  return (
    trimmed === JOB_BOARD_POST_HEADER ||
    trimmed === LEGACY_JOB_BOARD_POST_HEADER
  );
}

function skipLegacyHeaderBlock(lines: string[], startIndex: number): number {
  let bodyStartIndex = startIndex;
  if (lines[bodyStartIndex]?.trim() === JOB_BOARD_POST_DIVIDER) {
    bodyStartIndex++;
  }
  while (bodyStartIndex < lines.length && lines[bodyStartIndex]?.trim() === "") {
    bodyStartIndex++;
  }
  if (
    bodyStartIndex < lines.length &&
    isRoleOrClaimLine(lines[bodyStartIndex] ?? "")
  ) {
    bodyStartIndex++;
  }
  while (bodyStartIndex < lines.length && lines[bodyStartIndex]?.trim() === "") {
    bodyStartIndex++;
  }
  if (
    bodyStartIndex < lines.length &&
    lines[bodyStartIndex]?.trim() === JOB_BOARD_POST_DIVIDER
  ) {
    bodyStartIndex++;
  }
  while (bodyStartIndex < lines.length && lines[bodyStartIndex]?.trim() === "") {
    bodyStartIndex++;
  }
  return bodyStartIndex;
}

function skipCurrentHeaderBlock(lines: string[], startIndex: number): number {
  let bodyStartIndex = startIndex;
  while (
    bodyStartIndex < lines.length &&
    (lines[bodyStartIndex]?.trim() === "" ||
      isRoleOrClaimLine(lines[bodyStartIndex] ?? ""))
  ) {
    if (isRoleOrClaimLine(lines[bodyStartIndex] ?? "")) {
      bodyStartIndex++;
      continue;
    }
    bodyStartIndex++;
  }
  if (
    bodyStartIndex < lines.length &&
    lines[bodyStartIndex]?.trim() === JOB_BOARD_POST_DIVIDER
  ) {
    bodyStartIndex++;
  }
  while (bodyStartIndex < lines.length && lines[bodyStartIndex]?.trim() === "") {
    bodyStartIndex++;
  }
  return bodyStartIndex;
}

export function buildDefaultJobBoardPostText(
  order: JobBoardOrderInput,
  options?: JobBoardPostTextOptions,
): string {
  const roleMention = formatJobBoardNotifyRoleMention(options?.notifyRoleId);
  return [
    ...buildHeaderBlock(roleMention || null),
    buildJobBoardPostBody(order),
  ].join("\n");
}

export function transformOpenPostToClaimed(
  openPostText: string,
  vendor: JobBoardClaimVendor,
): string {
  const claimLine = vendor.discordId?.trim()
    ? `Claimed by <@${vendor.discordId.trim()}>`
    : `Claimed by ${vendor.name}`;

  const lines = openPostText.replace(/\r\n/g, "\n").split("\n");
  let bodyStartIndex = 0;

  if (isJobBoardPostHeaderLine(lines[0])) {
    bodyStartIndex = 1;
    if (lines[bodyStartIndex]?.trim() === JOB_BOARD_POST_DIVIDER) {
      bodyStartIndex = skipLegacyHeaderBlock(lines, bodyStartIndex);
    } else {
      bodyStartIndex = skipCurrentHeaderBlock(lines, bodyStartIndex);
    }
  } else {
    while (bodyStartIndex < lines.length && isDiscordPingLine(lines[bodyStartIndex] ?? "")) {
      bodyStartIndex++;
    }
    while (bodyStartIndex < lines.length && lines[bodyStartIndex]?.trim() === "") {
      bodyStartIndex++;
    }
  }

  const body = lines.slice(bodyStartIndex).join("\n").trimEnd();
  const legacyClaimPattern = /\n\n\*\*Claimed\*\* by .+$/s;
  const cleanedBody = body.replace(legacyClaimPattern, "");

  return [
    ...buildHeaderBlock(claimLine),
    cleanedBody,
  ].join("\n");
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
      fileName: jobBoardDiscordFileName(
        part.currentCad!.s3Key,
        part.currentCad!.fileName,
      ),
      s3Key: part.currentCad!.s3Key,
      partId: part.partId,
    }));
  pushChunkedFileMessages(messages, "cad", cadFiles);

  const drawingFiles: JobBoardPostFile[] = input.parts.flatMap((part) =>
    part.drawings.map((drawing) => ({
      fileName: jobBoardDiscordFileName(drawing.s3Key, drawing.fileName),
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
      fileName: jobBoardDiscordFileName(
        attachment.s3Key,
        attachment.fileName,
      ),
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
  notifyRoleId?: string | null;
}) {
  const postText =
    input.postText ??
    buildDefaultJobBoardPostText(input.order, {
      notifyRoleId: input.notifyRoleId,
    });
  const selectedAttachmentIds = input.selectedAttachmentIds ?? [];
  const messages = planJobBoardMessages({
    postText,
    parts: input.order.parts,
    attachments: input.order.attachments,
    selectedAttachmentIds,
  });

  return {
    defaultText: buildDefaultJobBoardPostText(input.order, {
      notifyRoleId: input.notifyRoleId,
    }),
    postText,
    textOverLimit: isPostTextOverLimit(postText),
    messages,
  };
}
