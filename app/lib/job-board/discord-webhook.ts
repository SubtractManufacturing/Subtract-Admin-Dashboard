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
