import { db } from "../db";
import { sentEmails, sentEmailAttachments, attachments } from "../db/schema";
import { eq } from "drizzle-orm";
import { downloadFile } from "../s3.server";
import { isOutboundEmailEnabled } from "../featureFlags";
import { sendViaPostmark } from "./postmark.server";

export async function sendOutboundEmail(sentEmailId: number): Promise<string> {
  const [row] = await db
    .select()
    .from(sentEmails)
    .where(eq(sentEmails.id, sentEmailId))
    .limit(1);
  if (!row) throw new Error(`sent_emails row ${sentEmailId} not found`);

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
    .innerJoin(
      attachments,
      eq(sentEmailAttachments.attachmentId, attachments.id)
    )
    .where(eq(sentEmailAttachments.sentEmailId, sentEmailId));

  const postmarkAttachments = await Promise.all(
    junctionRows.map(async (a) => ({
      Name: a.fileName,
      Content: (await downloadFile(a.s3Key)).toString("base64"),
      ContentType: a.contentType,
    }))
  );

  return sendViaPostmark(row, postmarkAttachments);
}
