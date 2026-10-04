import { randomUUID } from "node:crypto";

import {
  getDeveloperSetting,
  RFQ_INTAKE_SETTINGS,
  setDeveloperSetting,
} from "../developerSettings";
import {
  maskRfqWebhookUrl,
  validateRfqWebhookUrl,
  type RfqNotifier,
  type RfqTestWebhookEvent,
  type RfqWebhookEvent,
} from "./outbound-webhook";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function deliverRfqWebhook(
  url: string,
  event: RfqWebhookEvent,
  fetcher: Fetcher = fetch,
): Promise<{ status: number; ok: boolean }> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, ok: response.ok };
}

export async function getRfqWebhookSetting() {
  const url =
    (await getDeveloperSetting(RFQ_INTAKE_SETTINGS.OUTBOUND_WEBHOOK_URL)) ?? "";
  return {
    configured: Boolean(url),
    maskedUrl: maskRfqWebhookUrl(url),
  };
}

export async function saveRfqWebhookSetting(
  rawUrl: string,
  updatedBy: string,
): Promise<{ ok: true; maskedUrl: string } | { ok: false; error: string }> {
  const validation = validateRfqWebhookUrl(rawUrl);
  if (!validation.ok) return validation;
  const saved = await setDeveloperSetting(
    RFQ_INTAKE_SETTINGS.OUTBOUND_WEBHOOK_URL,
    validation.url || null,
    updatedBy,
  );
  if (!saved) {
    return { ok: false, error: "Could not save webhook URL" };
  }
  return { ok: true, maskedUrl: maskRfqWebhookUrl(validation.url) };
}

export async function sendRfqTestEvent(
  rawUrl?: string,
  fetcher: Fetcher = fetch,
): Promise<
  | { ok: true; status: number }
  | { ok: false; status?: number; error: string }
> {
  const candidate =
    rawUrl ??
    (await getDeveloperSetting(RFQ_INTAKE_SETTINGS.OUTBOUND_WEBHOOK_URL)) ??
    "";
  const validation = validateRfqWebhookUrl(candidate);
  if (!validation.ok) return validation;
  if (!validation.url) {
    return { ok: false, error: "Enter or save a webhook URL first" };
  }
  const event: RfqTestWebhookEvent = {
    eventId: randomUUID(),
    event: "rfq.test",
    occurredAt: new Date().toISOString(),
    data: { test: true },
  };
  try {
    const result = await deliverRfqWebhook(validation.url, event, fetcher);
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: `Receiver returned HTTP ${result.status}`,
      };
    }
    return { ok: true, status: result.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Webhook request failed",
    };
  }
}

export const httpRfqNotifier: RfqNotifier = {
  notify(event) {
    void (async () => {
      const url = await getDeveloperSetting(
        RFQ_INTAKE_SETTINGS.OUTBOUND_WEBHOOK_URL,
      );
      if (!url) return;
      const result = await deliverRfqWebhook(url, event);
      if (!result.ok) {
        console.error(
          `[RFQ Intake] outbound webhook ${maskRfqWebhookUrl(url)} returned HTTP ${result.status}`,
        );
      }
    })().catch((error) => {
      console.error(
        "[RFQ Intake] outbound webhook delivery failed",
        error instanceof Error ? error.message : String(error),
      );
    });
  },
};
