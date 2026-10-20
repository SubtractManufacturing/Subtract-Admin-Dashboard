import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryDiscordWebhookClient } from "./discord-webhook";
import { sendJobBoardPost } from "./sender.server";
import type { JobBoardOrderInput } from "./types";

const mocks = vi.hoisted(() => ({
  updateOrder: vi.fn(),
  createEvent: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("../orders.js", () => ({
  updateOrder: mocks.updateOrder,
}));

vi.mock("../events.js", () => ({
  createEvent: mocks.createEvent,
}));

vi.mock("../s3.server.js", () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock("./thumbnail-post-process.server.js", () => ({
  flattenJobBoardThumbnailOnWhite: (buffer: Buffer) => buffer,
}));

const orderInput: JobBoardOrderInput = {
  orderNumber: "25Z00001",
  ndaRequired: false,
  deliveryDate: null,
  leadTime: null,
  shopPay: "100.00",
  generalNotes: null,
  parts: [
    {
      partId: "part-1",
      partName: "Bracket",
      quantity: 1,
      material: null,
      tolerance: null,
      finishing: null,
      approxSize: null,
      thumbnailS3Key: "thumb.png",
      currentCad: { s3Key: "cad.step", fileName: "cad.step" },
      drawings: [],
    },
  ],
  attachments: [],
};

describe("job board sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadFile.mockResolvedValue(Buffer.from("file"));
  });

  it("updates status and writes posted event on full success", async () => {
    const discord = new MemoryDiscordWebhookClient();
    const result = await sendJobBoardPost({
      orderId: 1,
      orderInput,
      webhookUrl: "https://discord.com/api/webhooks/1/token",
      postText: "Board post",
      selectedAttachmentIds: [],
      startAtMessageIndex: 0,
      discord,
      eventContext: { userId: "u1", userEmail: "ops@example.com" },
    });

    expect(result.ok).toBe(true);
    expect(mocks.updateOrder).toHaveBeenCalledWith(
      1,
      { status: "Waiting_For_Shop_Selection" },
      expect.any(Object),
    );
    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "posted_to_job_board",
        metadata: expect.objectContaining({
          webhookId: "1",
          postText: "Board post",
          messages: expect.arrayContaining([
            expect.objectContaining({ group: "text" }),
          ]),
        }),
      }),
    );
    expect(discord.executes).toHaveLength(3);
  });

  it("leaves the order unchanged and writes no event when a send fails", async () => {
    const discord = new MemoryDiscordWebhookClient();
    discord.failOnExecuteIndex = 1;

    const result = await sendJobBoardPost({
      orderId: 1,
      orderInput,
      webhookUrl: "https://discord.com/api/webhooks/1/token",
      postText: "Board post",
      selectedAttachmentIds: [],
      startAtMessageIndex: 0,
      discord,
      eventContext: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedGroup).toBe("thumbnails");
      expect(result.sentMessages).toHaveLength(1);
    }
    expect(mocks.updateOrder).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("retries from a later message without reposting earlier groups", async () => {
    const discord = new MemoryDiscordWebhookClient();
    const priorSentMessages = [
      { messageId: "msg-1", group: "text" as const, fileNames: [] },
    ];

    await sendJobBoardPost({
      orderId: 1,
      orderInput,
      webhookUrl: "https://discord.com/api/webhooks/1/token",
      postText: "Board post",
      selectedAttachmentIds: [],
      startAtMessageIndex: 1,
      priorSentMessages,
      discord,
      eventContext: {},
    });

    expect(discord.executes).toHaveLength(2);
    expect(discord.executes[0].fileNames).toEqual(["Bracket-thumbnail.png"]);
  });
});
