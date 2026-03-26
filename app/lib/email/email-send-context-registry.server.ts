import type { SentEmail } from "~/lib/db/schema";
import type { EmailContextKey } from "~/lib/email/email-context-registry";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import { quoteSendEmailHandler } from "~/lib/email/handlers/quote-send-email.server";

/**
 * Per–email-context server behavior: validation, merge props, attachments, side effects.
 * Registered in EMAIL_SEND_CONTEXT_HANDLERS — must have one entry per EmailContextKey.
 */
export interface EmailSendContextHandler {
  assertCanSend(auth: EmailEnqueueAuth, entityId: string): Promise<void>;
  /** Primary To: address for the envelope */
  getRecipientEmail(auth: EmailEnqueueAuth, entityId: string): Promise<string>;
  buildMergeProps(entityId: string): Promise<Record<string, string>>;
  verifyAttachmentIds(
    auth: EmailEnqueueAuth,
    entityId: string,
    attachmentIds: string[],
  ): Promise<void>;
  beforeEnqueue?(entityId: string, auth: EmailEnqueueAuth): Promise<void>;
  afterSent(row: SentEmail): Promise<void>;
}

export const EMAIL_SEND_CONTEXT_HANDLERS = {
  quote_send: quoteSendEmailHandler,
} as const satisfies Record<EmailContextKey, EmailSendContextHandler>;

export function getEmailSendHandler(
  key: EmailContextKey,
): EmailSendContextHandler {
  const h = EMAIL_SEND_CONTEXT_HANDLERS[key];
  if (!h) {
    throw new Error(`No email send handler for context ${key}`);
  }
  return h;
}
