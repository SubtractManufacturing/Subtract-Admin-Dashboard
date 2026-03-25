import type { Job } from "pg-boss";
import type { SendEmailPayload } from "../types";
import { db } from "../../db";
import { sentEmails } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { sendOutboundEmail } from "../../email/send-outbound.server";
import { isOutboundEmailEnabled } from "../../featureFlags";
import { createEvent } from "../../events";
import { transitionQuoteToSent } from "../../quotes.server";

type PermanentError = Error & { permanent?: boolean };

export async function handleSendEmail(jobs: Job<SendEmailPayload>[]) {
  for (const job of jobs) {
    const { sentEmailId } = job.data;

    const [row] = await db
      .select()
      .from(sentEmails)
      .where(eq(sentEmails.id, sentEmailId))
      .limit(1);
    if (!row) throw new Error(`sent_emails row ${sentEmailId} not found`);

    // Idempotency: already sent — no-op (handles pg-boss duplicate delivery)
    if (row.status === "sent") return;

    // Atomic claim: only proceed if we transition queued -> sending
    const claimed = await db
      .update(sentEmails)
      .set({ status: "sending", updatedAt: new Date() })
      .where(
        and(eq(sentEmails.id, sentEmailId), eq(sentEmails.status, "queued"))
      )
      .returning();
    if (claimed.length === 0) return; // another worker instance claimed it

    if (!(await isOutboundEmailEnabled())) {
      await db
        .update(sentEmails)
        .set({
          status: "failed",
          errorMessage: "Outbound email is disabled by feature flag",
          updatedAt: new Date(),
        })
        .where(eq(sentEmails.id, sentEmailId));
      return;
    }

    try {
      const messageId = await sendOutboundEmail(sentEmailId);

      await db
        .update(sentEmails)
        .set({
          status: "sent",
          providerMessageId: messageId,
          updatedAt: new Date(),
        })
        .where(eq(sentEmails.id, sentEmailId));

      await createEvent({
        entityType: "quote",
        entityId: row.quoteId.toString(),
        eventType: "quote_email_sent",
        eventCategory: "communication",
        title: "Quote email sent",
        description: `Email delivered to ${row.toAddresses.join(", ")}`,
        metadata: { sentEmailId, providerMessageId: messageId },
        userId: row.sentByUserId ?? undefined,
        userEmail: row.sentByUserEmail ?? undefined,
      });

      const result = await transitionQuoteToSent(row.quoteId, {
        userId: row.sentByUserId ?? undefined,
        userEmail: row.sentByUserEmail ?? undefined,
      });
      if (!result.success) {
        // Email was already delivered — log but don't re-throw
        console.error(
          `[Worker:SendEmail] Quote ${row.quoteId} transition failed: ${result.error}`
        );
      }
    } catch (err: unknown) {
      const normalizedErr: PermanentError =
        err instanceof Error ? (err as PermanentError) : (new Error(String(err)) as PermanentError);
      const isPermanent = normalizedErr.permanent === true;

      if (isPermanent) {
        // Permanent failure (e.g. 422): mark failed, don't re-throw
        await db
          .update(sentEmails)
          .set({
            status: "failed",
            errorMessage: String(normalizedErr),
            updatedAt: new Date(),
          })
          .where(eq(sentEmails.id, sentEmailId));
      } else {
        // Transient (429, network, etc.): revert to queued so retry picks it up cleanly
        await db
          .update(sentEmails)
          .set({
            status: "queued",
            errorMessage: String(normalizedErr),
            updatedAt: new Date(),
          })
          .where(eq(sentEmails.id, sentEmailId));
        throw normalizedErr; // pg-boss retries with backoff
      }
    }
  }
}
