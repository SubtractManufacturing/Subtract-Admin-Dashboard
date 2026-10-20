import { describe, expect, it, vi } from "vitest";

import { MemoryDiscordWebhookClient } from "./discord-webhook";
import * as claimUpdater from "./claim-updater.server";

describe("buildClaimedPostText", () => {
  it("mentions the vendor Discord ID when present", () => {
    expect(
      claimUpdater.buildClaimedPostText("Order post", {
        name: "Acme Shop",
        discordId: "123456789",
      }),
    ).toContain("<@123456789>");
  });

  it("falls back to the vendor name without a Discord ID", () => {
    expect(
      claimUpdater.buildClaimedPostText("Order post", {
        name: "Acme Shop",
        discordId: null,
      }),
    ).toContain("Claimed by Acme Shop");
  });
});

describe("updateJobBoardClaim", () => {
  it("skips Discord when the order was marked as sent", async () => {
    vi.spyOn(claimUpdater, "orderWasMarkedAsSentToJobBoard").mockResolvedValue(
      true,
    );
    const discord = new MemoryDiscordWebhookClient();

    const result = await claimUpdater.updateJobBoardClaim({
      orderId: 1,
      vendorId: 2,
      webhookUrl: "https://discord.com/api/webhooks/1/token",
      discord,
    });

    expect(result).toEqual({ ok: true });
    expect(discord.edits).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
