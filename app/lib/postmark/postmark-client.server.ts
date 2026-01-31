import { ServerClient } from "postmark";
import { LinkTrackingOptions } from "postmark/dist/client/models/message/SupportingTypes";
import { render } from "@react-email/render";
import { QuoteEmail } from "~/emails/QuoteEmail";
import { createEmail, getOrCreateThreadId } from "~/lib/emails";
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
 * Get the reply-to address from developer settings
 */
async function getReplyToAddress(): Promise<string | null> {
  try {
    const { getEmailReplyToAddress } = await import("~/lib/developerSettings");
    return await getEmailReplyToAddress();
  } catch (error) {
    console.warn("Could not load reply-to from developerSettings:", error);
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

    // Get reply-to address for inbound routing
    const replyTo = await getReplyToAddress();
    
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
