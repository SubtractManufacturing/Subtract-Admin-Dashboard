import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleRfqWebhook } from "./webhook.server";

const SECRET = "test-webhook-secret";
const RECEIPT_KEY =
  "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a10/meta/receipt.json";

function signedRequest(
  body: string,
  signature = createHmac("sha256", SECRET).update(body).digest("hex"),
) {
  return new Request("https://erp.example.com/api/rfq-intake/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-rfq-signature": `sha256=${signature}`,
    },
    body,
  });
}

describe("RFQ intake webhook", () => {
  it("authenticates the exact raw body and enqueues the receipt pointer", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const rawBody = JSON.stringify({ receipt_key: RECEIPT_KEY });

    const response = await handleRfqWebhook(signedRequest(rawBody), {
      enabled: true,
      secret: SECRET,
      enqueue,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(enqueue).toHaveBeenCalledWith(RECEIPT_KEY);
  });

  it.each([
    ["missing", undefined],
    ["invalid", "0".repeat(64)],
  ])("rejects a %s signature without enqueueing", async (_label, signature) => {
    const enqueue = vi.fn();
    const rawBody = JSON.stringify({ receipt_key: RECEIPT_KEY });
    const request = signedRequest(rawBody, signature);
    if (signature === undefined) request.headers.delete("x-rfq-signature");

    const response = await handleRfqWebhook(request, {
      enabled: true,
      secret: SECRET,
      enqueue,
    });

    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects malformed pointers after authentication", async () => {
    const enqueue = vi.fn();
    const rawBody = JSON.stringify({ receipt_key: "intake/not-safe/manifest.json" });

    const response = await handleRfqWebhook(signedRequest(rawBody), {
      enabled: true,
      secret: SECRET,
      enqueue,
    });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns unavailable while intake is disabled", async () => {
    const enqueue = vi.fn();
    const rawBody = JSON.stringify({ receipt_key: RECEIPT_KEY });

    const response = await handleRfqWebhook(signedRequest(rawBody), {
      enabled: false,
      secret: SECRET,
      enqueue,
    });

    expect(response.status).toBe(503);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
