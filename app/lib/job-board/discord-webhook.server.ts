import { discordWebhookMessageEditUrl } from "./webhook";
import {
  DiscordWebhookError,
  type DiscordWebhookClient,
} from "./discord-webhook";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createFetchDiscordWebhookClient(
  fetcher: Fetcher = fetch,
): DiscordWebhookClient {
  return {
    async executeWebhook(webhookUrl, params) {
      const url = new URL(webhookUrl);
      url.searchParams.set("wait", "true");

      let body: BodyInit;
      const headers: Record<string, string> = {};

      if (params.files?.length) {
        const form = new FormData();
        const payload: Record<string, unknown> = {};
        if (params.content) payload.content = params.content;
        form.set("payload_json", JSON.stringify(payload));
        params.files.forEach((file, index) => {
          form.set(
            `files[${index}]`,
            new Blob([new Uint8Array(file.data)]),
            file.name,
          );
        });
        body = form;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ content: params.content ?? "" });
      }

      const response = await fetcher(url.toString(), {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new DiscordWebhookError(
          detail || `Discord webhook returned HTTP ${response.status}`,
          response.status,
        );
      }

      return (await response.json()) as Awaited<
        ReturnType<DiscordWebhookClient["executeWebhook"]>
      >;
    },

    async editWebhookMessage(webhookUrl, messageId, params) {
      const response = await fetcher(
        discordWebhookMessageEditUrl(webhookUrl, messageId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: params.content }),
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new DiscordWebhookError(
          detail || `Discord edit returned HTTP ${response.status}`,
          response.status,
        );
      }
    },
  };
}
