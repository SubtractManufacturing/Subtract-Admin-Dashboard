import { describe, expect, it } from "vitest";

import {
  maskJobBoardWebhookUrl,
  parseDiscordWebhookId,
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
});
