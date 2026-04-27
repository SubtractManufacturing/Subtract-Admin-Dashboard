import type { SentEmail } from "../db/schema";

const SERVER_TOKEN =
  process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN;
const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM;

/** Avoid hanging indefinitely when outbound HTTPS to Postmark is blocked or stalled. */
const POSTMARK_REQUEST_TIMEOUT_MS = 60_000;

function isAbortOrTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /aborted|timeout/i.test(error.message))
  );
}

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

export type PostmarkTransactionalPayload = {
  fromEmail: string;
  fromDisplayName: string | null;
  toAddresses: string[];
  replyTo: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
  /** When set, replaces To. Intentionally omitted for admin template test sends. */
  recipientOverride?: string | null;
  ccAddresses?: string[] | null;
  /** Hidden copy; does not change the primary To recipient. */
  globalBcc?: string | null;
  attachments?: PostmarkAttachment[];
};

/**
 * Sends one message via Postmark. Prefer this for ad-hoc sends; queued mail uses
 * {@link sendViaPostmark} with a `sent_emails` row.
 */
export async function sendPostmarkTransactionalEmail(
  input: PostmarkTransactionalPayload,
): Promise<string> {
  if (!SERVER_TOKEN) {
    throw new Error(
      "POSTMARK_SERVER_TOKEN or POSTMARK_API_TOKEN must be set to send emails",
    );
  }

  const from = input.fromDisplayName
    ? `${input.fromDisplayName} <${input.fromEmail}>`
    : input.fromEmail;

  const isOverride = !!input.recipientOverride;
  const to = isOverride
    ? input.recipientOverride!
    : input.toAddresses.join(", ");
  const cc =
    !isOverride && input.ccAddresses?.length
      ? input.ccAddresses.join(", ")
      : undefined;

  const bccRaw = (input.globalBcc ?? "").trim();
  const toLower = to.toLowerCase();
  const bccLower = bccRaw.toLowerCase();
  const duplicatesEnvelope =
    !bccRaw ||
    bccLower === toLower ||
    input.toAddresses.some((a) => a.toLowerCase() === bccLower) ||
    Boolean(
      input.ccAddresses?.some((a) => a.toLowerCase() === bccLower),
    );
  const bccFinal = duplicatesEnvelope ? undefined : bccRaw;

  const attachmentBuffers = input.attachments ?? [];

  const payload = {
    From: from,
    To: to,
    ...(cc ? { Cc: cc } : {}),
    ...(bccFinal ? { Bcc: bccFinal } : {}),
    ...(input.replyTo ? { ReplyTo: input.replyTo } : {}),
    ...(MESSAGE_STREAM ? { MessageStream: MESSAGE_STREAM } : {}),
    Subject: input.subject,
    HtmlBody: input.htmlBody,
    TextBody: input.textBody ?? "",
    Attachments: attachmentBuffers,
  };

  let response: Response;
  try {
    response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": SERVER_TOKEN,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(POSTMARK_REQUEST_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    if (isAbortOrTimeout(e)) {
      throw new Error(
        `Postmark request timed out after ${POSTMARK_REQUEST_TIMEOUT_MS / 1000}s. Check network, VPN, or firewall access to api.postmarkapp.com.`,
      );
    }
    throw e;
  }

  if (response.status === 429) {
    throw new Error("Postmark rate limit (429) — will retry");
  }
  if (!response.ok) {
    const body = await response.text();
    const isPermanent = response.status >= 400 && response.status < 500;
    const err: PermanentError = new Error(
      `Postmark error ${response.status}: ${body}`,
    );
    err.permanent = isPermanent;
    throw err;
  }

  const data = (await response.json()) as { MessageID: string };
  return data.MessageID;
}

export async function sendViaPostmark(
  row: SentEmail,
  attachmentBuffers: PostmarkAttachment[],
  options?: { globalBcc?: string | null },
) {
  return sendPostmarkTransactionalEmail({
    fromEmail: row.fromEmail,
    fromDisplayName: row.fromDisplayName,
    toAddresses: row.toAddresses,
    replyTo: row.replyTo,
    subject: row.subject,
    htmlBody: row.htmlBody,
    textBody: row.textBody ?? "",
    recipientOverride: row.recipientOverride,
    ccAddresses: row.ccAddresses,
    globalBcc: options?.globalBcc ?? null,
    attachments: attachmentBuffers,
  });
}
