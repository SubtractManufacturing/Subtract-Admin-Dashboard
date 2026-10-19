export function validateJobBoardWebhookUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, url: "" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a valid webhook URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: "Webhook URL must use http:// or https://",
    };
  }
  if (!url.pathname.includes("/webhooks/")) {
    return {
      ok: false,
      error: "URL must be a Discord incoming webhook",
    };
  }
  return { ok: true, url: value };
}

export function maskJobBoardWebhookUrl(value: string): string {
  if (!value) return "";
  return new URL(value).origin;
}

export function parseDiscordWebhookId(webhookUrl: string): string | null {
  try {
    const parts = new URL(webhookUrl).pathname.split("/").filter(Boolean);
    const webhookIndex = parts.indexOf("webhooks");
    if (webhookIndex === -1 || !parts[webhookIndex + 1]) return null;
    return parts[webhookIndex + 1];
  } catch {
    return null;
  }
}

export function discordWebhookMessageEditUrl(
  webhookUrl: string,
  messageId: string,
): string {
  const base = webhookUrl.replace(/\/$/, "");
  return `${base}/messages/${messageId}`;
}
