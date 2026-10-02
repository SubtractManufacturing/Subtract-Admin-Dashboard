import { createHmac, timingSafeEqual } from "node:crypto";

import { json } from "@remix-run/node";

import { isReceiptKey } from "./keys";

export const RFQ_SIGNATURE_HEADER = "x-rfq-signature";

export type RfqWebhookDependencies = {
  enabled: boolean;
  secret: string;
  enqueue(receiptKey: string): Promise<void>;
};

function signatureMatches(rawBody: string, supplied: string | null, secret: string) {
  if (!supplied || !secret) return false;

  const suppliedHex = supplied.startsWith("sha256=")
    ? supplied.slice("sha256=".length)
    : supplied;
  if (!/^[a-f\d]{64}$/i.test(suppliedHex)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(suppliedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function handleRfqWebhook(
  request: Request,
  dependencies: RfqWebhookDependencies,
) {
  if (!dependencies.enabled) {
    return json({ error: "RFQ intake is disabled" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (
    !signatureMatches(
      rawBody,
      request.headers.get(RFQ_SIGNATURE_HEADER),
      dependencies.secret,
    )
  ) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const receiptKey =
    typeof body === "object" && body !== null
      ? ((body as Record<string, unknown>).receipt_key ??
        (body as Record<string, unknown>).receiptKey)
      : undefined;
  if (typeof receiptKey !== "string" || !isReceiptKey(receiptKey)) {
    return json({ error: "Invalid receipt pointer" }, { status: 400 });
  }

  await dependencies.enqueue(receiptKey);
  return json({ accepted: true }, { status: 202 });
}
