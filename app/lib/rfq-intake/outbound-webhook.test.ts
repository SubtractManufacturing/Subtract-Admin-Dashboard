import { describe, expect, it, vi } from "vitest";

import {
  maskRfqWebhookUrl,
  validateRfqWebhookUrl,
} from "./outbound-webhook";
import {
  deliverRfqWebhook,
  sendRfqTestEvent,
} from "./outbound-webhook.server";

describe("RFQ outbound webhook settings", () => {
  it("accepts explicit HTTP and HTTPS URLs and preserves HTTP", () => {
    expect(validateRfqWebhookUrl("http://n8n:5678/webhook/rfq")).toEqual({
      ok: true,
      url: "http://n8n:5678/webhook/rfq",
    });
    expect(validateRfqWebhookUrl("https://hooks.example.com/secret")).toEqual({
      ok: true,
      url: "https://hooks.example.com/secret",
    });
  });

  it("accepts an empty value and rejects unsupported schemes", () => {
    expect(validateRfqWebhookUrl(" ")).toEqual({ ok: true, url: "" });
    expect(validateRfqWebhookUrl("ftp://example.com/hook")).toEqual({
      ok: false,
      error: "Webhook URL must use http:// or https://",
    });
  });

  it("masks a saved URL to its scheme and host", () => {
    expect(
      maskRfqWebhookUrl("https://hooks.example.com/unguessable?token=secret"),
    ).toBe("https://hooks.example.com");
  });

  it("posts one JSON event and returns the receiver status", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const event = {
      eventId: "event-1",
      event: "rfq.test" as const,
      occurredAt: "2026-09-21T00:00:00.000Z",
      data: { test: true as const },
    };

    await expect(
      deliverRfqWebhook("http://localhost:5678/hook", event, fetcher),
    ).resolves.toEqual({ status: 202, ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:5678/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }),
    );
  });

  it("surfaces test-event HTTP and network failures", async () => {
    await expect(
      sendRfqTestEvent(
        "https://hooks.example.com/test",
        vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      ),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Receiver returned HTTP 503",
    });
    await expect(
      sendRfqTestEvent(
        "https://hooks.example.com/test",
        vi.fn().mockRejectedValue(new Error("connection refused")),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "connection refused",
    });
  });
});
