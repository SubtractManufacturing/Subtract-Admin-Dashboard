import type { SentEmail } from "../db/schema";

const SERVER_TOKEN =
  process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN;
const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM;

if (!SERVER_TOKEN) {
  console.warn(
    "POSTMARK_SERVER_TOKEN or POSTMARK_API_TOKEN must be set to send emails"
  );
}

export interface PostmarkAttachment {
  Name: string;
  Content: string; // base64
  ContentType: string;
}

type PermanentError = Error & { permanent?: boolean };

export async function sendViaPostmark(
  row: SentEmail,
  attachmentBuffers: PostmarkAttachment[]
) {
  if (!SERVER_TOKEN) {
    throw new Error(
      "POSTMARK_SERVER_TOKEN or POSTMARK_API_TOKEN must be set to send emails"
    );
  }

  const from = row.fromDisplayName ? `${row.fromDisplayName} <${row.fromEmail}>` : row.fromEmail;

  // Recipient override logic
  const isOverride = !!row.recipientOverride;
  const to = isOverride ? row.recipientOverride! : row.toAddresses.join(", ");
  // Do not send CC if override is active
  const cc = (!isOverride && row.ccAddresses?.length) ? row.ccAddresses.join(", ") : undefined;

  const payload = {
    From: from,
    To: to,
    ...(cc ? { Cc: cc } : {}),
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
    const err: PermanentError = new Error(`Postmark error ${response.status}: ${body}`);
    err.permanent = isPermanent;
    throw err;
  }

  const data = (await response.json()) as { MessageID: string };
  return data.MessageID;
}
