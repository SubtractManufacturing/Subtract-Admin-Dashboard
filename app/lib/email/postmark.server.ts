import type { SentEmail } from "../db/schema";

const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS;
const FROM_NAME = process.env.EMAIL_FROM_NAME;
const SERVER_TOKEN =
  process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN;
const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM;

if (!FROM_ADDRESS || !SERVER_TOKEN) {
  console.warn(
    "EMAIL_FROM_ADDRESS and (POSTMARK_SERVER_TOKEN or POSTMARK_API_TOKEN) must be set to send emails"
  );
}

export interface PostmarkAttachment {
  Name: string;
  Content: string; // base64
  ContentType: string;
}

export async function sendViaPostmark(
  row: SentEmail,
  attachmentBuffers: PostmarkAttachment[]
) {
  if (!FROM_ADDRESS || !SERVER_TOKEN) {
    throw new Error(
      "EMAIL_FROM_ADDRESS and (POSTMARK_SERVER_TOKEN or POSTMARK_API_TOKEN) must be set to send emails"
    );
  }

  const from = FROM_NAME ? `${FROM_NAME} <${FROM_ADDRESS}>` : FROM_ADDRESS;

  const payload = {
    From: from,
    To: row.toAddresses.join(", "),
    ...(row.ccAddresses?.length ? { Cc: row.ccAddresses.join(", ") } : {}),
    ...(row.replyTo ? { ReplyTo: row.replyTo } : {}),
    ...(MESSAGE_STREAM ? { MessageStream: MESSAGE_STREAM } : {}),
    Subject: row.subject,
    HtmlBody: row.htmlBody,
    TextBody: row.textBody ?? "",
    Attachments: attachmentBuffers,
  };

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": SERVER_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 429) {
    // Throw a retryable error — pg-boss will back off and retry
    throw new Error("Postmark rate limit (429) — will retry");
  }
  if (!response.ok) {
    const body = await response.text();
    // 4xx (except 429): permanent failure — don't retry
    const isPermanent = response.status >= 400 && response.status < 500;
    const err = new Error(`Postmark error ${response.status}: ${body}`);
    (err as any).permanent = isPermanent;
    throw err;
  }

  const data = (await response.json()) as { MessageID: string };
  return data.MessageID;
}
