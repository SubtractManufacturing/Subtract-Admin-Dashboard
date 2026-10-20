import { describe, expect, it } from "vitest";

import {
  buildDefaultJobBoardPostText,
  buildJobBoardPostPreview,
  isPostTextOverLimit,
  planJobBoardMessages,
  transformOpenPostToClaimed,
} from "./post-builder";
import { DISCORD_MAX_POST_CHARS, type JobBoardOrderInput } from "./types";

const baseOrder: JobBoardOrderInput = {
  orderNumber: "26Z00074",
  ndaRequired: false,
  deliveryDate: "2026-11-03T12:00:00.000Z",
  leadTime: null,
  shopPay: "4198.00",
  generalNotes: null,
  parts: [
    {
      partId: "part-1",
      partName: "40J_312",
      quantity: 1,
      material: "POM-C (white)",
      tolerance: '±0.005"',
      finishing: null,
      approxSize: '17.00" × 10.00" × 1.00"',
      thumbnailS3Key: "thumbs/bracket.png",
      currentCad: { s3Key: "cad/bracket.step", fileName: "bracket.step" },
      drawings: [],
    },
    {
      partId: "part-2",
      partName: "89987TR6",
      quantity: 4,
      material: "1018 Steel",
      tolerance: null,
      finishing: null,
      approxSize: '4.21" × 2.11" × 1.00"',
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
      "attachments",
    ]);
    expect(messages[0].content).toBe("Hello board");
  });

  it("builds the open post with header first, role ping second, and per-part sections", () => {
    const text = buildDefaultJobBoardPostText(baseOrder, {
      notifyRoleId: "1367576185206476901",
    });

    expect(text.indexOf("# New Job Availability:")).toBe(0);
    expect(text.indexOf("<@&1367576185206476901>")).toBeGreaterThan(0);
    expect(text.indexOf("<@&1367576185206476901>")).toBeLessThan(
      text.indexOf("**Job Number:**"),
    );
    expect(text).toContain("**Part Name:** 40J_312");
    expect(text).toContain("**Quantity:** 1");
    expect(text).toContain("**Approx Size:** 17.00");
    expect(text).toContain("**Finish:** As Machined");
    expect(text).toContain("**Shop Pay:** $4,198.00");
    expect(text).toContain("**Lead Time:** Delivered");
    expect(text).not.toContain("totalPrice");
  });

  it("includes NDA suffix and warning without customer totals", () => {
    const text = buildDefaultJobBoardPostText(
      {
        ...baseOrder,
        ndaRequired: true,
        shopPay: "150.00",
      },
      { notifyRoleId: "1367576185206476901" },
    );

    expect(text).toContain("**Job Number:** 26Z00074 - NDA");
    expect(text).toContain("NDA required");
    expect(text).toContain("**Shop Pay:** $150.00");
    expect(text).not.toContain("**Total");
  });

  it("transforms an open post into a claimed post with header first", () => {
    const open = buildDefaultJobBoardPostText(baseOrder, {
      notifyRoleId: "1367576185206476901",
    });
    const claimed = transformOpenPostToClaimed(open, {
      name: "Acme Shop",
      discordId: "1371957126142099526",
    });

    expect(claimed.indexOf("# New Job Availability:")).toBe(0);
    expect(claimed).toContain("Claimed by <@1371957126142099526>");
    expect(claimed).not.toContain("<@&1367576185206476901>");
    expect(claimed).toContain("**Job Number:** 26Z00074");
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
