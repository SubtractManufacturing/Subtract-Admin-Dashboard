import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  attachments,
  sentEmailAttachments,
  type SentEmail,
} from "~/lib/db/schema";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import { downloadFile } from "~/lib/s3.server";
import { sendPostmarkTransactionalEmail } from "~/lib/email/postmark.server";

const PREVIEW_SUBJECT_PREFIX = "[Not sent to customer] ";

/**
 * Sends a one-off copy of the stored outbound content to the approver’s inbox
 * for real-client rendering QA. Does not use global recipient override so the
 * copy always reaches the approver’s real address. Does not change
 * `sent_emails` status.
 */
export async function sendApprovalPreviewToApproverInbox(
  row: SentEmail,
  approverEmail: string,
): Promise<string> {
  if (!(await isOutboundEmailEnabled())) {
    const err = new Error("Outbound email is disabled by feature flag");
    (err as { permanent?: boolean }).permanent = true;
    throw err;
  }

  const junctionRows = await db
    .select({
      s3Key: attachments.s3Key,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
    })
    .from(sentEmailAttachments)
    .innerJoin(attachments, eq(sentEmailAttachments.attachmentId, attachments.id))
    .where(eq(sentEmailAttachments.sentEmailId, row.id));

  const postmarkAttachments = await Promise.all(
    junctionRows.map(async (a) => ({
      Name: a.fileName,
      Content: (await downloadFile(a.s3Key)).toString("base64"),
      ContentType: a.contentType,
    })),
  );

  return sendPostmarkTransactionalEmail({
    fromEmail: row.fromEmail,
    fromDisplayName: row.fromDisplayName,
    toAddresses: [approverEmail],
    replyTo: row.replyTo,
    subject: `${PREVIEW_SUBJECT_PREFIX}${row.subject}`,
    htmlBody: row.htmlBody,
    textBody: row.textBody ?? "",
    // Intentionally omit recipientOverride: always deliver to approver.
    ccAddresses: undefined,
    attachments: postmarkAttachments,
  });
}
