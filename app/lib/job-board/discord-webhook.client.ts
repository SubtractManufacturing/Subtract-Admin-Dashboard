import { discordWebhookMessageEditUrl } from "./webhook";

export type DiscordWebhookFile = {
  name: string;
  data: Buffer;
};

export type DiscordWebhookExecuteResult = {
  id: string;
  webhook_id: string;
};

export class DiscordWebhookError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordWebhookError";
  }
}

export interface DiscordWebhookClient {
  executeWebhook(
    webhookUrl: string,
    params: { content?: string; files?: DiscordWebhookFile[] },
  ): Promise<DiscordWebhookExecuteResult>;
  editWebhookMessage(
    webhookUrl: string,
    messageId: string,
    params: { content: string },
  ): Promise<void>;
}

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

      return (await response.json()) as DiscordWebhookExecuteResult;
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

export class MemoryDiscordWebhookClient implements DiscordWebhookClient {
  readonly executes: Array<{
    webhookUrl: string;
    content?: string;
    fileNames: string[];
  }> = [];
  readonly edits: Array<{
    webhookUrl: string;
    messageId: string;
    content: string;
  }> = [];

  failOnExecuteIndex: number | null = null;
  failOnEdit = false;

  private messageCounter = 0;

  async executeWebhook(
    webhookUrl: string,
    params: { content?: string; files?: DiscordWebhookFile[] },
  ) {
    if (this.failOnExecuteIndex === this.executes.length) {
      throw new DiscordWebhookError("Simulated Discord failure", 500);
    }
    this.executes.push({
      webhookUrl,
      content: params.content,
      fileNames: params.files?.map((file) => file.name) ?? [],
    });
    this.messageCounter += 1;
    return {
      id: `msg-${this.messageCounter}`,
      webhook_id: "wh-1",
    };
  }

  async editWebhookMessage(
    webhookUrl: string,
    messageId: string,
    params: { content: string },
  ) {
    if (this.failOnEdit) {
      throw new DiscordWebhookError("Simulated edit failure", 500);
    }
    this.edits.push({ webhookUrl, messageId, content: params.content });
  }
}
