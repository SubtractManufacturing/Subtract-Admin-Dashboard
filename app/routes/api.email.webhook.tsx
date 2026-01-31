import { ActionFunctionArgs, json } from "@remix-run/node";
import { ServerClient } from "postmark";
import {
  createEmail,
  updateEmailStatus,
  getOrCreateThreadId,
  getEmailByPostmarkId,
} from "~/lib/emails";
import { processAttachments } from "~/lib/postmark/attachment-handler.server";
import { createEvent } from "~/lib/events";
import { logEmailEvent } from "~/lib/reconciliation/event-logger";
import { isInboundForwardEnabled } from "~/lib/featureFlags";
import { getEmailInboundForwardAddress } from "~/lib/developerSettings";

const POSTMARK_API_TOKEN = process.env.POSTMARK_API_TOKEN;
const POSTMARK_MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

// Email domain for forwarding "From" address
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "subtractmanufacturing.com";

/**
 * Get the inbound forward address (if feature is enabled)
 */
async function getInboundForwardAddress(): Promise<string | null> {
  try {
    const isEnabled = await isInboundForwardEnabled();
    if (!isEnabled) {
      return null;
    }
    return await getEmailInboundForwardAddress();
  } catch (error) {
    console.warn("Could not check inbound forward settings:", error);
    return null;
  }
}

/**
 * Webhook endpoint for Postmark email events
 * Handles: Inbound, Delivery, Bounce, SpamComplaint, Open, Click
 *
 * CRITICAL CONSTRAINTS:
 * - CONSTRAINT 1: Memory-safe attachment handling via processAttachments()
 * - CONSTRAINT 2: Thread matching using getOrCreateThreadId()
 * - CONSTRAINT 4: Metadata-first routing (no regex/string searches!)
 */
export async function action({ request }: ActionFunctionArgs) {
  // Verify webhook signature (Postmark uses JSON payload + secret)
  // TODO: Implement HMAC signature verification with POSTMARK_WEBHOOK_SECRET
  const signature = request.headers.get("X-Postmark-Signature");
  console.log("Webhook received, signature:", signature ? "present" : "missing");

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    console.error("Failed to parse webhook payload:", error);
    return json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Determine the record type
  // Note: Inbound emails don't have a RecordType field - detect them by checking for inbound-specific fields
  let recordType = payload.RecordType;
  if (!recordType && (payload.FromFull || payload.From) && payload.Subject !== undefined) {
    // This is an inbound email - it has From and Subject but no RecordType
    recordType = "Inbound";
  }
  
  console.log(`Processing webhook: ${recordType}`);
  console.log(`Payload keys: ${Object.keys(payload).join(", ")}`);

  try {
    switch (recordType) {
      case "Inbound": {
        // CONSTRAINT 4: Metadata-First Routing
        // Extract quoteId/orderId/customerId directly from Postmark Metadata
        // NEVER use regex on subject or search by sender email
        const metadata = payload.Metadata || {};
        const quoteId = metadata.quoteId ? parseInt(metadata.quoteId) : null;
        const orderId = metadata.orderId ? parseInt(metadata.orderId) : null;
        const customerId = metadata.customerId
          ? parseInt(metadata.customerId)
          : null;
        const vendorId = metadata.vendorId
          ? parseInt(metadata.vendorId)
          : null;

        console.log("Webhook metadata:", {
          quoteId,
          orderId,
          customerId,
          vendorId,
        });

        // CONSTRAINT 2: Thread matching using database integrity logic
        const inReplyTo =
          payload.Headers?.find(
            (h: { Name: string; Value: string }) =>
              h.Name.toLowerCase() === "in-reply-to"
          )?.Value || null;

        const messageId = payload.MessageID;
        // Uses randomUUID() for new threads, inherits parent's UUID for replies
        const threadId = await getOrCreateThreadId(inReplyTo, messageId);

        console.log(`Thread assignment: ${threadId} (reply: ${!!inReplyTo})`);

        // Create email record
        const emailRecord = await createEmail({
          postmarkMessageId: payload.MessageID,
          threadId,
          direction: "inbound",
          status: "delivered",
          fromAddress: payload.FromFull?.Email || payload.From,
          fromName: payload.FromFull?.Name || null,
          toAddresses: payload.ToFull?.map((t: { Email: string }) => t.Email) || [
            payload.To,
          ],
          ccAddresses:
            payload.CcFull?.map((c: { Email: string }) => c.Email) || [],
          subject: payload.Subject || "(No Subject)",
          textBody: payload.TextBody || null,
          htmlBody: payload.HtmlBody || null,
          messageId,
          inReplyTo,
          quoteId,
          orderId,
          customerId,
          vendorId,
          metadata: { postmark: payload },
          sentAt: payload.Date ? new Date(payload.Date) : new Date(),
        });

        console.log(`Created email record: ${emailRecord.id}`);

        // CONSTRAINT 1: Process attachments with memory-safe streaming
        if (payload.Attachments && payload.Attachments.length > 0) {
          console.log(`Processing ${payload.Attachments.length} attachment(s)`);
          await processAttachments(emailRecord.id, payload.Attachments);
        }

        // Gmail mirroring - forward to team inbox (if feature is enabled)
        const forwardAddress = await getInboundForwardAddress();
        if (forwardAddress && POSTMARK_API_TOKEN) {
          try {
            const postmarkClient = new ServerClient(POSTMARK_API_TOKEN);
            await postmarkClient.sendEmail({
              From: `noreply@${EMAIL_DOMAIN}`,
              To: forwardAddress,
              Subject: `[Inbound] ${payload.Subject}`,
              HtmlBody: `
                <div style="border-left: 4px solid #3b82f6; padding-left: 12px; margin-bottom: 16px; font-family: sans-serif;">
                  <p><strong>From:</strong> ${payload.FromFull?.Email || payload.From}</p>
                  <p><strong>To:</strong> ${payload.ToFull?.map((t: { Email: string }) => t.Email).join(", ") || payload.To}</p>
                  <p><strong>Date:</strong> ${payload.Date}</p>
                  ${quoteId ? `<p><strong>Quote:</strong> #${quoteId}</p>` : ""}
                  ${orderId ? `<p><strong>Order:</strong> #${orderId}</p>` : ""}
                  ${customerId ? `<p><strong>Customer:</strong> #${customerId}</p>` : ""}
                </div>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
                ${payload.HtmlBody || `<pre style="white-space: pre-wrap; font-family: monospace;">${payload.TextBody || ""}</pre>`}
              `,
              MessageStream: POSTMARK_MESSAGE_STREAM,
            });
            console.log(`Forwarded inbound email to: ${forwardAddress}`);
          } catch (error) {
            console.error("Failed to forward inbound email:", error);
            // Don't fail the webhook if forwarding fails
          }
        }

        // Create event log
        if (quoteId || orderId || customerId) {
          await createEvent({
            entityType: quoteId ? "quote" : orderId ? "order" : "customer",
            entityId: String(quoteId || orderId || customerId),
            eventType: "email_received",
            eventCategory: "communication",
            title: "Email Received",
            description: `Received email from ${payload.FromFull?.Email || payload.From}`,
            metadata: { emailId: emailRecord.id, subject: payload.Subject },
          });
        }

        return json({ success: true, emailId: emailRecord.id });
      }

      case "Delivery": {
        // Use Postmark MessageID for direct lookup (metadata already in DB)
        console.log(`Delivery notification for: ${payload.MessageID}`);
        await updateEmailStatus(payload.MessageID, "delivered", {
          deliveredAt: payload.DeliveredAt
            ? new Date(payload.DeliveredAt)
            : new Date(),
        });

        // Log email event for audit trail
        const email = await getEmailByPostmarkId(payload.MessageID);
        if (email) {
          await logEmailEvent(email.id, "delivered", {
            postmarkMessageId: payload.MessageID,
            source: "webhook",
            recipient: payload.Recipient,
          });
        }

        return json({ success: true });
      }

      case "Bounce": {
        console.log(`Bounce notification for: ${payload.MessageID}`);
        await updateEmailStatus(payload.MessageID, "bounced", {
          bouncedAt: payload.BouncedAt
            ? new Date(payload.BouncedAt)
            : new Date(),
          metadata: {
            bounceReason: payload.Description,
            bounceType: payload.Type,
          },
        });

        // Log email event for audit trail
        const bouncedEmail = await getEmailByPostmarkId(payload.MessageID);
        if (bouncedEmail) {
          await logEmailEvent(bouncedEmail.id, "bounced", {
            postmarkMessageId: payload.MessageID,
            source: "webhook",
            recipient: payload.Email,
            bounceReason: payload.Description,
            bounceType: payload.Type,
          });
        }

        return json({ success: true });
      }

      case "SpamComplaint": {
        console.log(`Spam complaint for: ${payload.MessageID}`);
        await updateEmailStatus(payload.MessageID, "spam_complaint", {
          metadata: {
            complainedAt: payload.BouncedAt
              ? new Date(payload.BouncedAt)
              : new Date(),
          },
        });

        // Log email event for audit trail
        const spamEmail = await getEmailByPostmarkId(payload.MessageID);
        if (spamEmail) {
          await logEmailEvent(spamEmail.id, "spam_complaint", {
            postmarkMessageId: payload.MessageID,
            source: "webhook",
            recipient: payload.Email,
          });
        }

        return json({ success: true });
      }

      case "Open": {
        // Track opens (optional feature)
        console.log(`Open notification for: ${payload.MessageID}`);
        await updateEmailStatus(payload.MessageID, null, {
          openedAt: payload.ReceivedAt
            ? new Date(payload.ReceivedAt)
            : new Date(),
          metadata: { openCount: payload.OpenCount || 1 },
        });

        // Log email event for audit trail
        const openedEmail = await getEmailByPostmarkId(payload.MessageID);
        if (openedEmail) {
          await logEmailEvent(openedEmail.id, "opened", {
            postmarkMessageId: payload.MessageID,
            source: "webhook",
            recipient: payload.Recipient,
            userAgent: payload.UserAgent,
            geo: payload.Geo
              ? { city: payload.Geo.City, country: payload.Geo.Country }
              : undefined,
          });
        }

        return json({ success: true });
      }

      case "Click": {
        // Track link clicks (optional feature)
        console.log(`Click notification for: ${payload.MessageID}`);
        await updateEmailStatus(payload.MessageID, null, {
          clickedAt: payload.ReceivedAt
            ? new Date(payload.ReceivedAt)
            : new Date(),
          metadata: { clickedUrl: payload.OriginalLink },
        });

        // Log email event for audit trail
        const clickedEmail = await getEmailByPostmarkId(payload.MessageID);
        if (clickedEmail) {
          await logEmailEvent(clickedEmail.id, "clicked", {
            postmarkMessageId: payload.MessageID,
            source: "webhook",
            recipient: payload.Recipient,
            clickedUrl: payload.OriginalLink,
          });
        }

        return json({ success: true });
      }

      default:
        console.log("Unknown webhook type:", recordType);
        return json({ success: true, message: "Unknown webhook type" });
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}

// Only POST is allowed for webhooks
export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
