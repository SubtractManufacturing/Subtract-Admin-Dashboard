import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryDiscordWebhookClient } from "./discord-webhook";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: mocks.limit,
          })),
          limit: mocks.limit,
        })),
      })),
    })),
  },
}));

vi.mock("../vendors", () => ({
  getVendor: vi.fn(),
}));

import { buildClaimedPostText, updateJobBoardClaim } from "./claim-updater.server";

describe("buildClaimedPostText", () => {
  it("mentions the vendor Discord ID when present", () => {
    expect(
      buildClaimedPostText("Order post", {
        name: "Acme Shop",
        discordId: "123456789",
      }),
    ).toContain("<@123456789>");
  });

  it("falls back to the vendor name without a Discord ID", () => {
    expect(
      buildClaimedPostText("Order post", {
        name: "Acme Shop",
        discordId: null,
      }),
    ).toContain("Claimed by Acme Shop");
  });
});

describe("updateJobBoardClaim", () => {
  beforeEach(() => {
    mocks.limit.mockReset();
  });

  it("skips Discord when the order was marked as sent", async () => {
    mocks.limit.mockResolvedValueOnce([{ id: 1 }]);
    const discord = new MemoryDiscordWebhookClient();

    const result = await updateJobBoardClaim({
      orderId: 1,
      vendorId: 2,
      webhookUrl: "https://discord.com/api/webhooks/1/token",
      discord,
    });

    expect(result).toEqual({ ok: true });
    expect(discord.edits).toHaveLength(0);
  });
});
