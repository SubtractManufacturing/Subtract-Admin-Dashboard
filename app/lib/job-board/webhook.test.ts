import { describe, expect, it } from "vitest";

import {
  formatJobBoardNotifyRoleMention,
  maskJobBoardWebhookUrl,
  parseDiscordWebhookId,
  validateJobBoardNotifyRoleId,
  validateJobBoardWebhookUrl,
} from "./webhook";

describe("job board webhook settings", () => {
  it("accepts Discord webhook URLs and masks the host", () => {
    const url = "https://discord.com/api/webhooks/123456/abcdef";
    expect(validateJobBoardWebhookUrl(url)).toEqual({ ok: true, url });
    expect(maskJobBoardWebhookUrl(url)).toBe("https://discord.com");
    expect(parseDiscordWebhookId(url)).toBe("123456");
  });

  it("accepts an empty value", () => {
    expect(validateJobBoardWebhookUrl(" ")).toEqual({ ok: true, url: "" });
  });

  it("rejects non-Discord and non-HTTPS webhook URLs", () => {
    expect(
      validateJobBoardWebhookUrl("http://discord.com/api/webhooks/1/token"),
    ).toEqual({ ok: false, error: "Webhook URL must use https://" });
    expect(
      validateJobBoardWebhookUrl("https://example.com/api/webhooks/1/token"),
    ).toEqual({
      ok: false,
      error: "URL must be a Discord incoming webhook",
    });
  });

  it("validates notification role IDs and formats mentions", () => {
    expect(validateJobBoardNotifyRoleId("987654321098765432")).toEqual({
      ok: true,
      roleId: "987654321098765432",
    });
    expect(validateJobBoardNotifyRoleId("abc")).toEqual({
      ok: false,
      error: "Role ID must be a numeric Discord snowflake (17–20 digits)",
    });
    expect(formatJobBoardNotifyRoleMention("987654321098765432")).toBe(
      "<@&987654321098765432>",
    );
  });
});
