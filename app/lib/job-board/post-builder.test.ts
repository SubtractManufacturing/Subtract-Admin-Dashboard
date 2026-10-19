import { describe, expect, it } from "vitest";

import {
  buildDefaultJobBoardPostText,
  buildJobBoardPostPreview,
  isPostTextOverLimit,
  planJobBoardMessages,
} from "./post-builder";
import { DISCORD_MAX_POST_CHARS, type JobBoardOrderInput } from "./types";

const baseOrder: JobBoardOrderInput = {
  orderNumber: "25Z00001",
  ndaRequired: false,
  deliveryDate: null,
  leadTime: 5,
  parts: [
    {
      partId: "part-1",
      partName: "Bracket",
      quantity: 2,
      thumbnailS3Key: "thumbs/bracket.png",
      currentCad: { s3Key: "cad/bracket.step", fileName: "bracket.step" },
      drawings: [
        {
          attachmentId: "draw-1",
          s3Key: "drawings/bracket.pdf",
          fileName: "bracket.pdf",
        },
      ],
    },
    {
      partId: "part-2",
      partName: "Plate",
      quantity: 1,
      thumbnailS3Key: null,
      currentCad: null,
      drawings: [],
    },
  ],
  attachments: [
    {
      attachmentId: "att-1",
      fileName: "packing.pdf",
      s3Key: "orders/packing.pdf",
    },
  ],
};

describe("job board post builder", () => {
  it("orders message groups as text, thumbnails, cad, drawings, attachments", () => {
    const messages = planJobBoardMessages({
      postText: "Hello board",
      parts: baseOrder.parts,
      attachments: baseOrder.attachments,
      selectedAttachmentIds: ["att-1"],
    });

    expect(messages.map((m) => m.group)).toEqual([
      "text",
      "thumbnails",
      "cad",
      "drawings",
      "attachments",
    ]);
    expect(messages[0].content).toBe("Hello board");
  });

  it("skips empty file groups", () => {
    const messages = planJobBoardMessages({
      postText: "Only text",
      parts: [
        {
          partId: "part-2",
          partName: "Plate",
          quantity: 1,
          thumbnailS3Key: null,
          currentCad: null,
          drawings: [],
        },
      ],
      attachments: baseOrder.attachments,
      selectedAttachmentIds: [],
    });

    expect(messages).toEqual([
      { group: "text", content: "Only text", files: [] },
    ]);
  });

  it("splits groups into messages of at most 10 files", () => {
    const manyThumbs = Array.from({ length: 11 }, (_, index) => ({
      partId: `part-${index}`,
      partName: `Part ${index}`,
      quantity: 1,
      thumbnailS3Key: `thumb/${index}.png`,
      currentCad: null,
      drawings: [],
    }));

    const messages = planJobBoardMessages({
      postText: "Bulk",
      parts: manyThumbs,
      attachments: [],
      selectedAttachmentIds: [],
    });

    const thumbnailMessages = messages.filter((m) => m.group === "thumbnails");
    expect(thumbnailMessages).toHaveLength(2);
    expect(thumbnailMessages[0].files).toHaveLength(10);
    expect(thumbnailMessages[1].files).toHaveLength(1);
  });

  it("includes only checked order attachments", () => {
    const messages = planJobBoardMessages({
      postText: "Files",
      parts: [],
      attachments: baseOrder.attachments,
      selectedAttachmentIds: [],
    });

    expect(messages.some((m) => m.group === "attachments")).toBe(false);
  });

  it("adds an NDA note and omits customer pricing from default text", () => {
    const text = buildDefaultJobBoardPostText({
      ...baseOrder,
      ndaRequired: true,
      totalPrice: "999.99",
    } as JobBoardOrderInput & { totalPrice: string });

    expect(text).toContain("NDA required");
    expect(text).not.toContain("999");
    expect(text).not.toContain("$");
    expect(text).toContain("Bracket × 2");
  });

  it("flags text over the 2000-character limit", () => {
    const longText = "x".repeat(DISCORD_MAX_POST_CHARS + 1);
    expect(isPostTextOverLimit(longText)).toBe(true);
    const preview = buildJobBoardPostPreview({
      order: baseOrder,
      postText: longText,
    });
    expect(preview.textOverLimit).toBe(true);
  });
});
