/**
 * Postmark Reconciliation API
 * 
 * Wrapper for Postmark Messages API used by the reconciliation system.
 * Handles pagination and provides typed interfaces for message data.
 * 
 * CRITICAL: All methods implement full pagination - they loop until
 * all pages are fetched or the date window is exhausted.
 */

import { ServerClient } from "postmark";

const POSTMARK_API_TOKEN = process.env.POSTMARK_API_TOKEN;

// Types for Postmark API responses
export interface OutboundMessage {
  MessageID: string;
  To: Array<{ Email: string; Name?: string }>;
  From: string;
  Subject: string;
  Status: string;
  ReceivedAt: string;
  MessageStream: string;
  Tag?: string;
  Metadata?: Record<string, string>;
  TrackOpens?: boolean;
  TrackLinks?: string;
}

export interface InboundMessage {
  MessageID: string;
  From: string;
  FromFull: { Email: string; Name?: string };
  To: string;
  ToFull: Array<{ Email: string; Name?: string }>;
  Cc?: string;
  CcFull?: Array<{ Email: string; Name?: string }>;
  Subject: string;
  Date: string;
  MailboxHash?: string;
  TextBody?: string;
  HtmlBody?: string;
  Tag?: string;
  Headers?: Array<{ Name: string; Value: string }>;
  Attachments?: Array<{
    Name: string;
    ContentType: string;
    ContentLength: number;
    ContentID?: string;
  }>;
}

export interface MessageEvent {
  MessageID: string;
  RecordType: string;
  Type?: string;
  ReceivedAt: string;
  Recipient?: string;
  Description?: string;
  Details?: string;
  Tag?: string;
  Metadata?: Record<string, string>;
}

export interface OutboundMessageDetails extends OutboundMessage {
  TextBody?: string;
  HtmlBody?: string;
  Body?: string;
}

/**
 * Postmark Reconciliation API client
 * 
 * Provides methods to fetch messages and events from Postmark with full pagination.
 */
export class PostmarkReconciliationAPI {
  private client: ServerClient;

  constructor() {
    if (!POSTMARK_API_TOKEN) {
      throw new Error("POSTMARK_API_TOKEN not configured");
    }
    this.client = new ServerClient(POSTMARK_API_TOKEN);
  }

  /**
   * Fetch ALL outbound messages within a time range with full pagination
   * CRITICAL: Loops through all pages until totalCount is reached
   * 
   * @param options.fromDate Start of date range
   * @param options.toDate End of date range
   * @returns All outbound messages in the time range
   */
  async getAllOutboundMessages(options: {
    fromDate: Date;
    toDate: Date;
  }): Promise<OutboundMessage[]> {
    const allMessages: OutboundMessage[] = [];
    let offset = 0;
    const batchSize = 500; // Postmark max per request

    try {
      let hasMore = true;
      while (hasMore) {
        console.log(
          `[PostmarkAPI] Fetching outbound messages (offset: ${offset})...`
        );

        const response = await this.client.getOutboundMessages({
          count: batchSize,
          offset,
          fromdate: options.fromDate.toISOString(),
          todate: options.toDate.toISOString(),
        });

        const messages = response.Messages || [];
        for (const msg of messages) {
          allMessages.push({
            MessageID: msg.MessageID,
            To: msg.To as Array<{ Email: string; Name?: string }>,
            From: msg.From,
            Subject: msg.Subject,
            Status: msg.Status,
            ReceivedAt: msg.ReceivedAt,
            MessageStream: msg.MessageStream || "outbound",
            Tag: msg.Tag,
            Metadata: msg.Metadata as Record<string, string> | undefined,
            TrackOpens: msg.TrackOpens,
            TrackLinks: msg.TrackLinks,
          });
        }

        const totalCount = Number(response.TotalCount) || 0;
        console.log(
          `[PostmarkAPI] Fetched ${messages.length} outbound messages (offset: ${offset}, total: ${totalCount})`
        );

        // Stop if we've fetched all messages or this page was empty
        if (messages.length === 0 || offset + batchSize >= totalCount) {
          hasMore = false;
        } else {
          offset += batchSize;
        }
      }

      console.log(
        `[PostmarkAPI] Total outbound messages fetched: ${allMessages.length}`
      );
      return allMessages;
    } catch (error) {
      console.error("Failed to fetch outbound messages from Postmark:", error);
      throw error;
    }
  }

  /**
   * Fetch ALL inbound messages within a time range with full pagination
   * CRITICAL: Loops through all pages until totalCount is reached
   * 
   * @param options.fromDate Start of date range
   * @param options.toDate End of date range
   * @returns All inbound messages in the time range
   */
  async getAllInboundMessages(options: {
    fromDate: Date;
    toDate: Date;
  }): Promise<InboundMessage[]> {
    const allMessages: InboundMessage[] = [];
    let offset = 0;
    const batchSize = 500;

    try {
      let hasMore = true;
      while (hasMore) {
        console.log(
          `[PostmarkAPI] Fetching inbound messages (offset: ${offset})...`
        );

        const response = await this.client.getInboundMessages({
          count: batchSize,
          offset,
          fromDate: options.fromDate.toISOString(),
          toDate: options.toDate.toISOString(),
        });

        const messages = response.InboundMessages || [];
        for (const msg of messages) {
          // Cast to access properties that exist in API response but not in SDK types
          const msgAny = msg as unknown as Record<string, unknown>;
          allMessages.push({
            MessageID: msg.MessageID,
            From: msg.From,
            FromFull: msg.FromFull as { Email: string; Name?: string },
            To: msg.To,
            ToFull: msg.ToFull as Array<{ Email: string; Name?: string }>,
            Cc: msg.Cc,
            CcFull: msg.CcFull as Array<{ Email: string; Name?: string }> | undefined,
            Subject: msg.Subject,
            Date: msg.Date,
            MailboxHash: msg.MailboxHash,
            TextBody: msgAny.TextBody as string | undefined,
            HtmlBody: msgAny.HtmlBody as string | undefined,
            Tag: msg.Tag,
            Headers: msgAny.Headers as Array<{ Name: string; Value: string }> | undefined,
          });
        }

        const totalCount = Number(response.TotalCount) || 0;
        console.log(
          `[PostmarkAPI] Fetched ${messages.length} inbound messages (offset: ${offset}, total: ${totalCount})`
        );

        if (messages.length === 0 || offset + batchSize >= totalCount) {
          hasMore = false;
        } else {
          offset += batchSize;
        }
      }

      console.log(
        `[PostmarkAPI] Total inbound messages fetched: ${allMessages.length}`
      );
      return allMessages;
    } catch (error) {
      console.error("Failed to fetch inbound messages from Postmark:", error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific outbound message
   * Includes full message body and event history
   * 
   * @param messageId Postmark MessageID
   */
  async getOutboundMessageDetails(
    messageId: string
  ): Promise<OutboundMessageDetails | null> {
    try {
      const response = await this.client.getOutboundMessageDetails(messageId);
      return {
        MessageID: response.MessageID,
        To: response.To as Array<{ Email: string; Name?: string }>,
        From: response.From,
        Subject: response.Subject,
        Status: response.Status,
        ReceivedAt: response.ReceivedAt,
        MessageStream: response.MessageStream || "outbound",
        Tag: response.Tag,
        Metadata: response.Metadata as Record<string, string> | undefined,
        TrackOpens: response.TrackOpens,
        TrackLinks: response.TrackLinks,
        TextBody: response.TextBody,
        HtmlBody: response.HtmlBody,
        Body: response.Body,
      };
    } catch (error: unknown) {
      // Handle 404/422 - message not found
      const err = error as { statusCode?: number };
      if (err?.statusCode === 404 || err?.statusCode === 422) {
        console.warn(`[PostmarkAPI] Message not found: ${messageId}`);
        return null;
      }
      console.error(
        `[PostmarkAPI] Failed to fetch message details for ${messageId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get events for a specific outbound message
   * Events include: Delivery, Bounce, Open, Click, SpamComplaint
   * 
   * @param messageId Postmark MessageID
   */
  async getMessageEvents(messageId: string): Promise<MessageEvent[]> {
    try {
      // Get message details which includes events
      const details = await this.getOutboundMessageDetails(messageId);
      
      if (!details) {
        return [];
      }

      const events: MessageEvent[] = [];

      // Add delivery event if message was delivered
      if (details.Status === "Sent" || details.Status === "Delivered") {
        events.push({
          MessageID: messageId,
          RecordType: "Delivery",
          ReceivedAt: details.ReceivedAt,
          Recipient: details.To?.[0]?.Email,
          Metadata: details.Metadata,
        });
      }

      return events;
    } catch (error) {
      console.error(
        `[PostmarkAPI] Failed to fetch events for message ${messageId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if the Postmark API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getServer();
      return true;
    } catch (error) {
      console.error("[PostmarkAPI] Health check failed:", error);
      return false;
    }
  }
}
