import { ServerClient } from "postmark";
import { LinkTrackingOptions } from "postmark/dist/client/models/message/SupportingTypes";
import { render } from "@react-email/render";
import { QuoteEmail } from "~/emails/QuoteEmail";
import { createEmail, getOrCreateThreadId, getEmailById } from "~/lib/emails";
import { randomUUID } from "crypto";

// Environment variables
const POSTMARK_API_TOKEN = process.env.POSTMARK_API_TOKEN;
const POSTMARK_MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

// Domain for Message-ID generation
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "subtractmanufacturing.com";

interface SendEmailOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
  quoteId?: number;
  orderId?: number;
  customerId?: number;
  vendorId?: number;
  inReplyTo?: string;
  threadId?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  errorCode?: number;
}

/**
 * Get the Postmark client instance
 */
function getPostmarkClient(): ServerClient {
  if (!POSTMARK_API_TOKEN) {
    throw new Error("POSTMARK_API_TOKEN environment variable is not set");
  }
  return new ServerClient(POSTMARK_API_TOKEN);
}

/**
 * Get the reply-to address - first checks per-address config, then falls back to global default
 */
async function getReplyToAddress(fromAddress?: string): Promise<string | null> {
  try {
    // If a from address is provided, check if it has a per-address reply-to
    if (fromAddress) {
      const { getSendAsAddressByEmail } = await import("~/lib/emailSendAsAddresses");
      const sendAsConfig = await getSendAsAddressByEmail(fromAddress);
      if (sendAsConfig?.replyToAddress) {
        return sendAsConfig.replyToAddress;
      }
    }
    
    // Fall back to global default reply-to
    const { getEmailReplyToAddress } = await import("~/lib/developerSettings");
    return await getEmailReplyToAddress();
  } catch (error) {
    console.warn("Could not load reply-to address:", error);
    return null;
  }
}

/**
 * Get the BCC address for outbound email mirroring (if enabled)
 * Returns null if the feature is disabled or no address is configured
 */
async function getOutboundBccAddress(): Promise<string | null> {
  try {
    const { isOutboundBccEnabled } = await import("~/lib/featureFlags");
    const { getEmailOutboundBccAddress } = await import("~/lib/developerSettings");
    
    // Check if feature is enabled
    const isEnabled = await isOutboundBccEnabled();
    if (!isEnabled) {
      return null;
    }
    
    // Get the configured address
    return await getEmailOutboundBccAddress();
  } catch (error) {
    console.warn("Could not check outbound BCC settings:", error);
    return null;
  }
}

/**
 * Send an email via Postmark with all critical constraints implemented:
 * - CONSTRAINT 3: Sender Verification Safety (422 error handling)
 * - CONSTRAINT 4: Metadata-First Routing (quoteId/orderId/customerId in metadata)
 * - Gmail mirroring via BCC
 * - Thread ID management
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { from, to, subject, body, quoteId, orderId, customerId, vendorId, inReplyTo } = options;

  if (!to || !subject || !body) {
    return {
      success: false,
      error: "Missing required fields: to, subject, and body are all required",
    };
  }

  try {
    const client = getPostmarkClient();

    // Render React Email template
    const htmlBody = await render(
      QuoteEmail({
        messageBody: body,
        subject: subject,
      })
    );

    // Generate Message-ID for threading (RFC 2822 format)
    const messageId = `<${Date.now()}-${randomUUID()}@${EMAIL_DOMAIN}>`;

    // Get reply-to address for inbound routing (checks per-address config, then global default)
    const replyTo = await getReplyToAddress(from);
    
    // Get BCC address for Gmail mirroring (if enabled via feature flag)
    const bccAddress = await getOutboundBccAddress();

    // Determine thread ID
    // CONSTRAINT 2: Use randomUUID() for roots, inherit parent's UUID for replies
    const threadId =
      options.threadId ||
      (inReplyTo
        ? await getOrCreateThreadId(inReplyTo, messageId)
        : randomUUID());

    // CONSTRAINT 4: Build Postmark metadata for efficient webhook lookups
    // This avoids expensive string searches on webhook receipt
    const metadata: Record<string, string> = {};
    if (quoteId) metadata.quoteId = String(quoteId);
    if (orderId) metadata.orderId = String(orderId);
    if (customerId) metadata.customerId = String(customerId);
    if (vendorId) metadata.vendorId = String(vendorId);
    metadata.threadId = threadId;

    console.log(`Sending email via Postmark: to=${to}, from=${from}, subject=${subject}`);
    console.log(`Metadata:`, metadata);

    // Build headers for threading
    const headers: { Name: string; Value: string }[] = [
      { Name: "Message-ID", Value: messageId },
    ];
    if (inReplyTo) {
      headers.push({ Name: "In-Reply-To", Value: inReplyTo });
    }

    // Send email via Postmark
    // CONSTRAINT 3: Wrapped in try-catch to handle 422 errors
    const result = await client.sendEmail({
      From: from,
      To: to,
      Bcc: bccAddress || undefined, // Gmail mirroring (if enabled)
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: body,
      ReplyTo: replyTo || undefined,
      MessageStream: POSTMARK_MESSAGE_STREAM,
      Headers: headers,
      Metadata: metadata, // CONSTRAINT 4: Metadata-First Routing
      TrackOpens: true,
      TrackLinks: LinkTrackingOptions.HtmlOnly,
    });

    console.log(`Email sent successfully. Postmark MessageID: ${result.MessageID}`);
    if (bccAddress) {
      console.log(`BCC copy sent to: ${bccAddress}`);
    }

    // Store in database
    await createEmail({
      postmarkMessageId: result.MessageID,
      postmarkMessageStreamId: POSTMARK_MESSAGE_STREAM,
      threadId,
      direction: "outbound",
      status: "sent",
      fromAddress: from,
      toAddresses: [to],
      bccAddresses: bccAddress ? [bccAddress] : [],
      replyTo: replyTo || undefined,
      subject,
      textBody: body,
      htmlBody,
      messageId,
      inReplyTo: inReplyTo || null,
      quoteId: quoteId || null,
      orderId: orderId || null,
      customerId: customerId || null,
      vendorId: vendorId || null,
      metadata: { postmark: metadata },
      gmailMirrored: !!bccAddress,
      sentAt: new Date(),
    });

    return {
      success: true,
      messageId: result.MessageID,
      threadId,
    };
  } catch (error: unknown) {
    // CONSTRAINT 3: Handle Postmark Error 422 - Unverified sender
    const err = error as { statusCode?: number; ErrorCode?: number; message?: string };
    if (err?.statusCode === 422 || err?.ErrorCode === 422) {
      const errorMessage =
        `Email address '${from}' is not verified in Postmark. ` +
        `Please add it as a Sender Signature in the Postmark dashboard: ` +
        `https://account.postmarkapp.com/servers/`;

      console.error("Postmark Sender Verification Error:", errorMessage);
      console.error("Full error:", error);

      return {
        success: false,
        error: errorMessage,
        errorCode: 422,
      };
    }

    // Handle other errors
    console.error("Failed to send email via Postmark:", error);
    return {
      success: false,
      error: err?.message || "Failed to send email",
      errorCode: err?.statusCode,
    };
  }
}

// ============================================
// Reply Function with Proper Threading Headers
// ============================================

interface SendReplyOptions {
  replyToEmailId: number; // Database ID of the email being replied to
  from: string;
  body: string;
  // Optional: override the recipient (defaults to original sender)
  to?: string;
}

/**
 * Send a reply to an existing email with proper RFC 2822 threading headers.
 * This ensures the reply is properly threaded in Gmail, Outlook, Apple Mail, etc.
 *
 * RFC 2822 Threading Headers:
 * - Message-ID: Unique identifier for this reply
 * - In-Reply-To: The Message-ID of the direct parent email
 * - References: Space-separated chain of ALL ancestor Message-IDs
 */
export async function sendReply(options: SendReplyOptions): Promise<SendEmailResult> {
  const { replyToEmailId, from, body, to: overrideTo } = options;

  // Fetch the parent email to get threading context
  const parentEmail = await getEmailById(replyToEmailId);
  if (!parentEmail) {
    return {
      success: false,
      error: `Email with ID ${replyToEmailId} not found`,
    };
  }

  // Determine the recipient:
  // - For replies to inbound emails: reply to the sender
  // - For replies to outbound emails: reply to the original recipient
  const to = overrideTo || (
    parentEmail.direction === "inbound"
      ? parentEmail.fromAddress
      : parentEmail.toAddresses?.[0]
  );

  if (!to) {
    return {
      success: false,
      error: "Could not determine recipient for reply",
    };
  }

  // Build subject with "Re:" prefix if not already present
  const subject = parentEmail.subject.startsWith("Re:")
    ? parentEmail.subject
    : `Re: ${parentEmail.subject}`;

  try {
    const client = getPostmarkClient();

    // Plain text replies - no HTML template
    // This makes emails feel more personal and human
    // (HTML templates are reserved for specific tasks like sending quotes)

    // Generate new Message-ID for this reply (RFC 2822 format)
    const messageId = `<${Date.now()}-${randomUUID()}@${EMAIL_DOMAIN}>`;

    // Build In-Reply-To header (parent's Message-ID)
    const inReplyTo = parentEmail.messageId || undefined;

    // Build References header (chain of all ancestor Message-IDs)
    // RFC 2822: References should contain all ancestor Message-IDs
    let references: string | undefined;
    if (parentEmail.references && parentEmail.messageId) {
      // Append parent's Message-ID to existing references chain
      references = `${parentEmail.references} ${parentEmail.messageId}`;
    } else if (parentEmail.messageId) {
      // Start new references chain with parent's Message-ID
      references = parentEmail.messageId;
    }

    // Inherit thread ID from parent (maintains our internal threading)
    const threadId = parentEmail.threadId;

    // Get reply-to address for inbound routing (checks per-address config, then global default)
    const replyToAddress = await getReplyToAddress(from);

    // Get BCC address for Gmail mirroring (if enabled)
    const bccAddress = await getOutboundBccAddress();

    // Build Postmark metadata (inherit from parent + add new)
    const metadata: Record<string, string> = {
      threadId,
    };
    if (parentEmail.quoteId) metadata.quoteId = String(parentEmail.quoteId);
    if (parentEmail.orderId) metadata.orderId = String(parentEmail.orderId);
    if (parentEmail.customerId) metadata.customerId = String(parentEmail.customerId);
    if (parentEmail.vendorId) metadata.vendorId = String(parentEmail.vendorId);

    console.log(`Sending reply via Postmark: to=${to}, from=${from}, subject=${subject}`);
    console.log(`Threading: inReplyTo=${inReplyTo}, threadId=${threadId}`);

    // Build headers for cross-client threading
    const headers: { Name: string; Value: string }[] = [
      { Name: "Message-ID", Value: messageId },
    ];
    if (inReplyTo) {
      headers.push({ Name: "In-Reply-To", Value: inReplyTo });
    }
    if (references) {
      headers.push({ Name: "References", Value: references });
    }

    // Send email via Postmark - plain text only for human-like replies
    const result = await client.sendEmail({
      From: from,
      To: to,
      Bcc: bccAddress || undefined,
      Subject: subject,
      TextBody: body, // Plain text only - feels more personal
      ReplyTo: replyToAddress || undefined,
      MessageStream: POSTMARK_MESSAGE_STREAM,
      Headers: headers,
      Metadata: metadata,
      TrackOpens: false, // Disable tracking for plain text human emails
    });

    console.log(`Reply sent successfully. Postmark MessageID: ${result.MessageID}`);

    // Store reply in database (plain text only, no HTML)
    await createEmail({
      postmarkMessageId: result.MessageID,
      postmarkMessageStreamId: POSTMARK_MESSAGE_STREAM,
      threadId,
      direction: "outbound",
      status: "sent",
      fromAddress: from,
      toAddresses: [to],
      bccAddresses: bccAddress ? [bccAddress] : [],
      replyTo: replyToAddress || undefined,
      subject,
      textBody: body,
      htmlBody: null, // Plain text reply - no HTML
      messageId,
      inReplyTo: inReplyTo || null,
      references: references || null,
      quoteId: parentEmail.quoteId,
      orderId: parentEmail.orderId,
      customerId: parentEmail.customerId,
      vendorId: parentEmail.vendorId,
      metadata: { postmark: metadata },
      gmailMirrored: !!bccAddress,
      sentAt: new Date(),
    });

    return {
      success: true,
      messageId: result.MessageID,
      threadId,
    };
  } catch (error: unknown) {
    // Handle Postmark Error 422 - Unverified sender
    const err = error as { statusCode?: number; ErrorCode?: number; message?: string };
    if (err?.statusCode === 422 || err?.ErrorCode === 422) {
      const errorMessage =
        `Email address '${from}' is not verified in Postmark. ` +
        `Please add it as a Sender Signature in the Postmark dashboard: ` +
        `https://account.postmarkapp.com/servers/`;

      console.error("Postmark Sender Verification Error:", errorMessage);
      return {
        success: false,
        error: errorMessage,
        errorCode: 422,
      };
    }

    console.error("Failed to send reply via Postmark:", error);
    return {
      success: false,
      error: err?.message || "Failed to send reply",
      errorCode: err?.statusCode,
    };
  }
}

/**
 * Validate that a sender address is ready for use.
 * This doesn't make an API call - it's a reminder for the admin.
 */
export function validateSenderAddress(address: string): {
  valid: boolean;
  warning?: string;
} {
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(address)) {
    return {
      valid: false,
      warning: `Invalid email format: ${address}`,
    };
  }

  // Return valid with a reminder to verify in Postmark
  return {
    valid: true,
    warning:
      `Remember: This address must be verified as a Sender Signature in Postmark ` +
      `or you will receive a 422 error when sending.`,
  };
}
