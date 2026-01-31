/**
 * Event logger for reconciliation system
 * 
 * Logs reconciliation events to the existing event_logs table:
 * - System events: reconciliation_started, reconciliation_completed, reconciliation_failed
 * - Email events: email_delivered, email_bounced, email_opened, email_clicked, email_spam_complaint
 * 
 * IDEMPOTENCY NOTE:
 * The event_logs table does not have unique constraints, so callers must ensure
 * they don't log duplicate events (use state protection via timestamps).
 */

import { createEvent } from "~/lib/events";
import type { ReconciliationResult } from "./types";

/**
 * Log the start of a reconciliation run
 * Returns the event ID for correlating with the completion event
 */
export async function logReconciliationStart(
  taskId: string,
  taskName: string,
  windowHours: number,
  triggeredBy?: string
): Promise<string> {
  const event = await createEvent({
    entityType: "system",
    entityId: `reconciliation_${taskId}`,
    eventType: "reconciliation_started",
    eventCategory: "system",
    title: `${taskName} Reconciliation Started`,
    description: `Reconciling ${windowHours}h window`,
    metadata: {
      taskId,
      windowHours,
      triggeredBy,
      startedAt: new Date().toISOString(),
    },
  });
  return event.id;
}

/**
 * Log the completion (success or failure) of a reconciliation run
 */
export async function logReconciliationComplete(
  taskId: string,
  taskName: string,
  result: ReconciliationResult,
  startEventId: string
): Promise<void> {
  await createEvent({
    entityType: "system",
    entityId: `reconciliation_${taskId}`,
    eventType: result.success ? "reconciliation_completed" : "reconciliation_failed",
    eventCategory: "system",
    title: `${taskName} Reconciliation ${result.success ? "Completed" : "Failed"}`,
    description: `Fetched ${result.summary.itemsFetched}, backfilled ${result.summary.itemsNew}, corrected ${result.summary.corrections}`,
    metadata: {
      taskId,
      ...result.summary,
      errors: result.errors,
      duration: result.duration,
      startEventId,
      completedAt: new Date().toISOString(),
    },
  });
}

/**
 * Email event types that can be logged
 */
export type EmailEventType =
  | "delivered"
  | "bounced"
  | "opened"
  | "clicked"
  | "spam_complaint";

/**
 * Details for an email event
 */
export interface EmailEventDetails {
  postmarkMessageId: string;
  source: "webhook" | "reconciliation";
  recipient?: string;
  bounceReason?: string;
  bounceType?: string;
  clickedUrl?: string;
  userAgent?: string;
  geo?: {
    city?: string;
    country?: string;
  };
}

/**
 * Log an email delivery event (delivered, bounced, opened, clicked, spam_complaint)
 * 
 * STATE PROTECTION: Callers should check timestamps before logging to avoid duplicates
 */
export async function logEmailEvent(
  emailId: number,
  eventType: EmailEventType,
  details: EmailEventDetails
): Promise<void> {
  const titles: Record<EmailEventType, string> = {
    delivered: "Email Delivered",
    bounced: "Email Bounced",
    opened: "Email Opened",
    clicked: "Email Link Clicked",
    spam_complaint: "Spam Complaint Received",
  };

  const descriptions: Record<EmailEventType, string> = {
    delivered: `Delivered to ${details.recipient || details.postmarkMessageId}`,
    bounced: details.bounceReason || `Bounced: ${details.bounceType || "unknown"}`,
    opened: `Opened by ${details.recipient || "recipient"}`,
    clicked: details.clickedUrl || "Link clicked",
    spam_complaint: `Spam complaint from ${details.recipient || "recipient"}`,
  };

  await createEvent({
    entityType: "email",
    entityId: String(emailId),
    eventType: `email_${eventType}`,
    eventCategory: "communication",
    title: titles[eventType],
    description: descriptions[eventType],
    metadata: {
      ...details,
      eventType,
      loggedAt: new Date().toISOString(),
    },
  });
}

/**
 * Log a generic reconciliation note/warning
 */
export async function logReconciliationNote(
  taskId: string,
  taskName: string,
  note: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await createEvent({
    entityType: "system",
    entityId: `reconciliation_${taskId}`,
    eventType: "reconciliation_note",
    eventCategory: "system",
    title: `${taskName} Note`,
    description: note,
    metadata: {
      taskId,
      ...metadata,
      loggedAt: new Date().toISOString(),
    },
  });
}
