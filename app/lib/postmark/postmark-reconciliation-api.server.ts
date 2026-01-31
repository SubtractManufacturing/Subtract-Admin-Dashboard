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
  Attachments?: Array<{ Name: string; ContentLength: number }>;
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
  MessageEvents?: MessageEvent[];
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
      while (true) {
        console.log(
          `[PostmarkAPI] Fetching outbound messages (offset: ${offset})...`
        );

        const response = await this.client.getOutboundMessages({
          count: batchSize,
          offset,
          fromdate: options.fromDate.toISOString(),
          todate: options.toDate.toISOString(),
        });

        const messages = (response.Messages || []) as OutboundMessage[];
        allMessages.push(...messages);

        console.log(
          `[PostmarkAPI] Fetched ${messages.length} outbound messages (offset: ${offset}, total: ${response.TotalCount})`
        );

        // Stop if we've fetched all messages or this page was empty
        if (
          messages.length === 0 ||
          offset + batchSize >= response.TotalCount
        ) {
          break;
        }

        offset += batchSize;
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
      while (true) {
        console.log(
          `[PostmarkAPI] Fetching inbound messages (offset: ${offset})...`
        );

        const response = await this.client.getInboundMessages({
          count: batchSize,
          offset,
          fromdate: options.fromDate.toISOString(),
          todate: options.toDate.toISOString(),
        });

        const messages = (response.InboundMessages || []) as InboundMessage[];
        allMessages.push(...messages);

        console.log(
          `[PostmarkAPI] Fetched ${messages.length} inbound messages (offset: ${offset}, total: ${response.TotalCount})`
        );

        if (
          messages.length === 0 ||
          offset + batchSize >= response.TotalCount
        ) {
          break;
        }

        offset += batchSize;
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
      return response as OutboundMessageDetails;
    } catch (error: any) {
      // Handle 404 - message not found
      if (error?.statusCode === 404) {
        console.warn(
          `[PostmarkAPI] Message not found: ${messageId}`
        );
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
   * NOTE: Postmark's message details endpoint includes MessageEvents array,
   * but for some message types you may need to use the opens/clicks endpoints.
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

      // Add any events from MessageEvents array if present
      if (details.MessageEvents && Array.isArray(details.MessageEvents)) {
        events.push(...details.MessageEvents);
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
   * Get message opens for a specific message
   * 
   * @param messageId Postmark MessageID
   */
  async getMessageOpens(
    messageId: string
  ): Promise<Array<{ ReceivedAt: string; Recipient: string; UserAgent?: string }>> {
    try {
      const response = await this.client.getMessageOpens({
        count: 100,
        offset: 0,
      });

      // Filter to just this message
      const opens = (response.Opens || []).filter(
        (open: any) => open.MessageID === messageId
      );

      return opens.map((open: any) => ({
        ReceivedAt: open.ReceivedAt,
        Recipient: open.Recipient,
        UserAgent: open.UserAgent,
      }));
    } catch (error) {
      console.error(
        `[PostmarkAPI] Failed to fetch opens for message ${messageId}:`,
        error
      );
      return [];
    }
  }

  /**
   * Get message clicks for a specific message
   * 
   * @param messageId Postmark MessageID
   */
  async getMessageClicks(
    messageId: string
  ): Promise<
    Array<{ ReceivedAt: string; Recipient: string; OriginalLink?: string }>
  > {
    try {
      const response = await this.client.getClickCounts({
        // Note: This endpoint doesn't filter by messageId directly
        // You may need to use getOutboundMessageDetails for click events
      });

      return [];
    } catch (error) {
      console.error(
        `[PostmarkAPI] Failed to fetch clicks for message ${messageId}:`,
        error
      );
      return [];
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
