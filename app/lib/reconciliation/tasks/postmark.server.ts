/**
 * Postmark Reconciliation Task
 * 
 * Implements the ReconciliationTask interface for Postmark email reconciliation.
 * 
 * FEATURES:
 * - Syncs outbound and inbound messages from Postmark API
 * - Backfills missing messages that weren't captured by webhooks
 * - Updates message state based on API data
 * - Logs all email events to event_logs
 * 
 * CRITICAL CONSTRAINTS:
 * - BATCH PROCESSING: Processes 50 items at a time to avoid memory spikes
 * - STATE PROTECTION: Only updates if external event timestamp is newer
 * - IDEMPOTENCY: Safe to run multiple times without duplicates
 */

import { randomUUID } from "crypto";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "~/lib/db";
import { emails, type Email, type NewEmail, emailStatusEnum } from "~/lib/db/schema";
import { createEmail, getEmailByPostmarkId } from "~/lib/emails";
import {
  PostmarkReconciliationAPI,
  type OutboundMessage,
  type InboundMessage,
} from "~/lib/postmark/postmark-reconciliation-api.server";
import {
  ReconciliationTask,
  ReconciliationOptions,
  ReconciliationResult,
} from "../types";
import { logEmailEvent, type EmailEventType } from "../event-logger";

// Batch size for processing - prevents memory spikes
const BATCH_SIZE = 50;

export class PostmarkReconciliationTask implements ReconciliationTask {
  readonly id = "postmark";
  readonly name = "Postmark Email";
  readonly description =
    "Reconcile Postmark outbound/inbound messages and delivery events";

  private api: PostmarkReconciliationAPI;

  constructor() {
    this.api = new PostmarkReconciliationAPI();
  }

  /**
   * Validate that required configuration is present
   */
  async validateConfig(): Promise<string[]> {
    const errors: string[] = [];

    if (!process.env.POSTMARK_API_TOKEN) {
      errors.push("POSTMARK_API_TOKEN environment variable is not set");
    }

    // Try a health check
    try {
      const healthy = await this.api.healthCheck();
      if (!healthy) {
        errors.push("Postmark API health check failed");
      }
    } catch (error) {
      errors.push(
        `Postmark API connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return errors;
  }

  /**
   * Execute the reconciliation task
   * IDEMPOTENT: Safe to run multiple times
   */
  async execute(options: ReconciliationOptions): Promise<ReconciliationResult> {
    const toDate = new Date();
    const fromDate = new Date(
      toDate.getTime() - options.windowHours * 60 * 60 * 1000
    );

    console.log(
      `[PostmarkTask] Starting reconciliation for ${options.windowHours}h window (${fromDate.toISOString()} to ${toDate.toISOString()})`
    );

    let itemsFetched = 0;
    let itemsNew = 0;
    let itemsUpdated = 0;
    let corrections = 0;
    const errors: string[] = [];

    try {
      // Step 1: Reconcile outbound messages
      console.log("[PostmarkTask] Step 1/3: Reconciling outbound messages...");
      try {
        const outbound = await this.reconcileOutboundMessages(fromDate, toDate);
        itemsFetched += outbound.fetched;
        itemsNew += outbound.new;
        itemsUpdated += outbound.updated;
      } catch (error) {
        const msg = `Outbound reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[PostmarkTask] ${msg}`);
        errors.push(msg);
      }

      // Step 2: Reconcile inbound messages
      console.log("[PostmarkTask] Step 2/3: Reconciling inbound messages...");
      try {
        const inbound = await this.reconcileInboundMessages(fromDate, toDate);
        itemsFetched += inbound.fetched;
        itemsNew += inbound.new;
        itemsUpdated += inbound.updated;
      } catch (error) {
        const msg = `Inbound reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[PostmarkTask] ${msg}`);
        errors.push(msg);
      }

      // Step 3: Reconcile message events (deliveries, bounces, etc.)
      console.log("[PostmarkTask] Step 3/3: Reconciling message events...");
      try {
        const events = await this.reconcileMessageEvents(fromDate, toDate);
        itemsFetched += events.fetched;
        itemsUpdated += events.updated;
        corrections += events.stateCorrections;
      } catch (error) {
        const msg = `Events reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[PostmarkTask] ${msg}`);
        errors.push(msg);
      }

      console.log(
        `[PostmarkTask] Reconciliation complete. Fetched: ${itemsFetched}, New: ${itemsNew}, Updated: ${itemsUpdated}, Corrections: ${corrections}`
      );

      return {
        success: errors.length === 0,
        summary: {
          itemsFetched,
          itemsNew,
          itemsUpdated,
          corrections,
        },
        errors,
        duration: 0, // Set by scheduler
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PostmarkTask] Fatal error:`, error);
      errors.push(msg);

      return {
        success: false,
        summary: {
          itemsFetched,
          itemsNew,
          itemsUpdated,
          corrections,
        },
        errors,
        duration: 0,
      };
    }
  }

  /**
   * Reconcile outbound messages from Postmark
   * BATCH PROCESSING: Processes 50 items at a time
   */
  private async reconcileOutboundMessages(
    from: Date,
    to: Date
  ): Promise<{ fetched: number; new: number; updated: number }> {
    const allMessages = await this.api.getAllOutboundMessages({
      fromDate: from,
      toDate: to,
    });

    const fetched = allMessages.length;
    let newCount = 0;
    let updatedCount = 0;

    // Process in batches to avoid memory spikes
    for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
      const batch = allMessages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allMessages.length / BATCH_SIZE);

      console.log(
        `[PostmarkTask] Processing outbound batch ${batchNum}/${totalBatches} (${batch.length} messages)`
      );

      for (const message of batch) {
        try {
          const result = await this.processOutboundMessage(message);
          if (result === "new") newCount++;
          if (result === "updated") updatedCount++;
        } catch (error) {
          console.error(
            `[PostmarkTask] Failed to process outbound message ${message.MessageID}:`,
            error
          );
        }
      }
    }

    return { fetched, new: newCount, updated: updatedCount };
  }

  /**
   * Process a single outbound message
   * STATE PROTECTION: Only updates if message timestamp is newer
   */
  private async processOutboundMessage(
    message: OutboundMessage
  ): Promise<"new" | "updated" | "skipped"> {
    const existing = await getEmailByPostmarkId(message.MessageID);
    const messageTimestamp = new Date(message.ReceivedAt);

    if (!existing) {
      // Backfill missing message
      await createEmail({
        postmarkMessageId: message.MessageID,
        postmarkMessageStreamId: message.MessageStream,
        threadId: message.Metadata?.threadId || randomUUID(),
        direction: "outbound",
        status: this.mapPostmarkStatus(message.Status),
        fromAddress: message.From,
        toAddresses: message.To.map((t) => t.Email),
        subject: message.Subject,
        messageId: `<${message.MessageID}>`,
        metadata: { postmark: message.Metadata },
        sentAt: messageTimestamp,
        stateSource: "reconciliation",
        lastReconciledAt: new Date(),
        // Extract entity IDs from metadata if present
        quoteId: message.Metadata?.quoteId
          ? parseInt(message.Metadata.quoteId)
          : null,
        orderId: message.Metadata?.orderId
          ? parseInt(message.Metadata.orderId)
          : null,
        customerId: message.Metadata?.customerId
          ? parseInt(message.Metadata.customerId)
          : null,
        vendorId: message.Metadata?.vendorId
          ? parseInt(message.Metadata.vendorId)
          : null,
      });

      console.log(
        `[PostmarkTask] Backfilled outbound message: ${message.MessageID}`
      );
      return "new";
    }

    // STATE PROTECTION: Only update if the message timestamp is newer
    if (
      !existing.lastReconciledAt ||
      messageTimestamp > existing.lastReconciledAt
    ) {
      const newStatus = this.mapPostmarkStatus(message.Status);

      await db
        .update(emails)
        .set({
          lastReconciledAt: new Date(),
          status: newStatus,
          stateSource: "reconciliation",
          updatedAt: new Date(),
        })
        .where(eq(emails.id, existing.id));

      return "updated";
    }

    return "skipped";
  }

  /**
   * Reconcile inbound messages from Postmark
   * BATCH PROCESSING: Processes 50 items at a time
   */
  private async reconcileInboundMessages(
    from: Date,
    to: Date
  ): Promise<{ fetched: number; new: number; updated: number }> {
    const allMessages = await this.api.getAllInboundMessages({
      fromDate: from,
      toDate: to,
    });

    const fetched = allMessages.length;
    let newCount = 0;
    let updatedCount = 0;

    // Process in batches
    for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
      const batch = allMessages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allMessages.length / BATCH_SIZE);

      console.log(
        `[PostmarkTask] Processing inbound batch ${batchNum}/${totalBatches} (${batch.length} messages)`
      );

      for (const message of batch) {
        try {
          const result = await this.processInboundMessage(message);
          if (result === "new") newCount++;
          if (result === "updated") updatedCount++;
        } catch (error) {
          console.error(
            `[PostmarkTask] Failed to process inbound message ${message.MessageID}:`,
            error
          );
        }
      }
    }

    return { fetched, new: newCount, updated: updatedCount };
  }

  /**
   * Process a single inbound message
   * STATE PROTECTION: Only updates if message timestamp is newer
   * THREADING: Uses In-Reply-To header to maintain thread integrity
   */
  private async processInboundMessage(
    message: InboundMessage
  ): Promise<"new" | "updated" | "skipped"> {
    const existing = await getEmailByPostmarkId(message.MessageID);
    const messageTimestamp = new Date(message.Date);

    if (!existing) {
      // Extract In-Reply-To header for thread matching
      const inReplyTo = message.Headers?.find(
        (h) => h.Name.toLowerCase() === "in-reply-to"
      )?.Value || null;

      // Use the same thread matching logic as the webhook handler
      // This ensures replies are properly threaded even when backfilled
      const { getOrCreateThreadId } = await import("~/lib/emails");
      const threadId = await getOrCreateThreadId(inReplyTo, message.MessageID);

      // Backfill missing inbound message
      await createEmail({
        postmarkMessageId: message.MessageID,
        threadId, // Properly threaded using In-Reply-To header
        direction: "inbound",
        status: "delivered", // Inbound messages are already delivered
        fromAddress: message.FromFull.Email,
        fromName: message.FromFull.Name || null,
        toAddresses: message.ToFull?.map((t) => t.Email) || [message.To],
        ccAddresses: message.CcFull?.map((c) => c.Email) || [],
        subject: message.Subject,
        textBody: message.TextBody || null,
        htmlBody: message.HtmlBody || null,
        messageId: `<${message.MessageID}>`,
        inReplyTo, // Store the In-Reply-To header for future reference
        sentAt: messageTimestamp,
        deliveredAt: messageTimestamp,
        stateSource: "reconciliation",
        lastReconciledAt: new Date(),
      });

      console.log(
        `[PostmarkTask] Backfilled inbound message: ${message.MessageID} (thread: ${threadId}, reply: ${!!inReplyTo})`
      );
      return "new";
    }

    // STATE PROTECTION: Only update if the message timestamp is newer
    if (
      !existing.lastReconciledAt ||
      messageTimestamp > existing.lastReconciledAt
    ) {
      await db
        .update(emails)
        .set({
          lastReconciledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emails.id, existing.id));

      return "updated";
    }

    return "skipped";
  }

  /**
   * Reconcile message events (deliveries, bounces, opens, clicks)
   * Fetches events for OUTBOUND messages only (inbound messages don't have delivery events)
   */
  private async reconcileMessageEvents(
    from: Date,
    to: Date
  ): Promise<{ fetched: number; updated: number; stateCorrections: number }> {
    // Get only OUTBOUND emails in the time window
    // Inbound messages don't have delivery events - they're already delivered when we receive them
    const emailsInWindow = await db.query.emails.findMany({
      where: and(
        gte(emails.sentAt, from),
        lte(emails.sentAt, to),
        eq(emails.direction, "outbound")
      ),
    });

    console.log(
      `[PostmarkTask] Fetching events for ${emailsInWindow.length} outbound emails in window`
    );

    let fetched = 0;
    let updated = 0;
    let stateCorrections = 0;

    // Process in batches
    for (let i = 0; i < emailsInWindow.length; i += BATCH_SIZE) {
      const batch = emailsInWindow.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(emailsInWindow.length / BATCH_SIZE);

      console.log(
        `[PostmarkTask] Processing events batch ${batchNum}/${totalBatches} (${batch.length} emails)`
      );

      for (const email of batch) {
        if (!email.postmarkMessageId) continue;

        try {
          const result = await this.processEmailEvents(email);
          fetched += result.eventCount;
          if (result.stateChanged) {
            stateCorrections++;
            updated++;
          }
        } catch (error) {
          console.error(
            `[PostmarkTask] Failed to fetch events for ${email.postmarkMessageId}:`,
            error
          );
        }
      }
    }

    return { fetched, updated, stateCorrections };
  }

  /**
   * Process events for a single email
   * STATE PROTECTION: Only processes events newer than lastReconciledAt
   */
  private async processEmailEvents(
    email: Email
  ): Promise<{ eventCount: number; stateChanged: boolean }> {
    if (!email.postmarkMessageId) {
      return { eventCount: 0, stateChanged: false };
    }

    const events = await this.api.getMessageEvents(email.postmarkMessageId);
    let eventCount = 0;
    let stateChanged = false;

    for (const event of events) {
      const eventTimestamp = new Date(event.ReceivedAt);

      // STATE PROTECTION: Only process events newer than last reconciliation
      if (email.lastReconciledAt && eventTimestamp <= email.lastReconciledAt) {
        continue;
      }

      eventCount++;

      // Log the event
      const eventType = this.mapEventTypeForLog(event.RecordType);
      if (eventType) {
        await logEmailEvent(email.id, eventType, {
          postmarkMessageId: email.postmarkMessageId,
          source: "reconciliation",
          recipient: event.Recipient,
          bounceReason: event.Description,
        });
      }

      // Update email status if needed
      const newStatus = this.deriveStatusFromEvent(event.RecordType);
      if (newStatus && newStatus !== email.status) {
        await db
          .update(emails)
          .set({
            status: newStatus,
            stateSource: "reconciliation",
            lastReconciledAt: new Date(),
            reconciliationNotes: `State corrected from ${email.status} to ${newStatus} based on ${event.RecordType} event`,
            updatedAt: new Date(),
            // Update timestamps based on event type
            ...(newStatus === "delivered" && { deliveredAt: eventTimestamp }),
            ...(newStatus === "bounced" && { bouncedAt: eventTimestamp }),
          })
          .where(eq(emails.id, email.id));

        stateChanged = true;
        console.log(
          `[PostmarkTask] State corrected for email ${email.id}: ${email.status} -> ${newStatus}`
        );
      }
    }

    // Update lastReconciledAt even if no state change
    if (eventCount > 0) {
      await db
        .update(emails)
        .set({
          lastReconciledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emails.id, email.id));
    }

    return { eventCount, stateChanged };
  }

  /**
   * Map Postmark message status to our email status enum
   */
  private mapPostmarkStatus(
    status: string
  ): "sent" | "delivered" | "bounced" | "spam_complaint" | "failed" {
    const mapping: Record<
      string,
      "sent" | "delivered" | "bounced" | "spam_complaint" | "failed"
    > = {
      Sent: "sent",
      Delivered: "delivered",
      Processed: "sent",
      Queued: "sent",
      Bounced: "bounced",
      HardBounce: "bounced",
      SoftBounce: "bounced",
      SpamComplaint: "spam_complaint",
      ManuallyDropped: "failed",
    };
    return mapping[status] || "sent";
  }

  /**
   * Map Postmark record type to our email event type for logging
   */
  private mapEventTypeForLog(recordType: string): EmailEventType | null {
    const mapping: Record<string, EmailEventType> = {
      Delivery: "delivered",
      Bounce: "bounced",
      HardBounce: "bounced",
      SoftBounce: "bounced",
      SpamComplaint: "spam_complaint",
      Open: "opened",
      Click: "clicked",
    };
    return mapping[recordType] || null;
  }

  /**
   * Derive email status from a Postmark event type
   * Returns null if the event doesn't affect status
   */
  private deriveStatusFromEvent(
    recordType: string
  ): "sent" | "delivered" | "bounced" | "spam_complaint" | "failed" | null {
    const mapping: Record<
      string,
      "sent" | "delivered" | "bounced" | "spam_complaint" | "failed"
    > = {
      Delivery: "delivered",
      Bounce: "bounced",
      HardBounce: "bounced",
      SoftBounce: "bounced",
      SpamComplaint: "spam_complaint",
    };
    return mapping[recordType] || null;
  }
}
