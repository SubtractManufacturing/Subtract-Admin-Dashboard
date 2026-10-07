export type RfqReceivedWebhookEvent = {
  eventId: string;
  event: "rfq.received";
  occurredAt: string;
  data: {
    receiptNumber: string | null;
    sessionId: string;
  };
};

export type RfqImportedWebhookEvent = {
  eventId: string;
  event: "rfq.imported";
  occurredAt: string;
  data: {
    quoteId: number;
    quoteNumber: string;
    customerId: number;
    customerName: string;
    partCount: number;
    ndaRequired: boolean;
  };
};

export type RfqFailedWebhookEvent = {
  eventId: string;
  event: "rfq.failed";
  occurredAt: string;
  data: {
    receiptNumber: string | null;
    sessionId: string;
    classification: string;
    safeDetail: string;
    attemptCount: number;
  };
};

export type RfqTestWebhookEvent = {
  eventId: string;
  event: "rfq.test";
  occurredAt: string;
  data: { test: true };
};

export type RfqLifecycleWebhookEvent =
  | RfqReceivedWebhookEvent
  | RfqImportedWebhookEvent
  | RfqFailedWebhookEvent;

export type RfqWebhookEvent =
  | RfqLifecycleWebhookEvent
  | RfqTestWebhookEvent;

export interface RfqNotifier {
  notify(event: RfqLifecycleWebhookEvent): void;
}

export class MemoryRfqNotifier implements RfqNotifier {
  readonly events: RfqLifecycleWebhookEvent[] = [];

  notify(event: RfqLifecycleWebhookEvent) {
    this.events.push(event);
  }
}

export function validateRfqWebhookUrl(
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
  return { ok: true, url: value };
}

export function maskRfqWebhookUrl(value: string): string {
  if (!value) return "";
  return new URL(value).origin;
}
