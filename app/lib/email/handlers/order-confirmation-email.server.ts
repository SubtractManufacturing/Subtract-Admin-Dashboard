import { db } from "~/lib/db";
import { attachments, orderAttachments } from "~/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getCustomer } from "~/lib/customers";
import { getOrder } from "~/lib/orders";
import type { EmailSendContextHandler } from "~/lib/email/email-send-context-registry.server";
import { resolveOrderTokens } from "~/lib/email/resolve/order.server";
import { resolveEmailTemplateForContext } from "~/lib/email/templates.server";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import { hasBlockingOrderContextSend } from "~/lib/sent-emails.server";
import { ATTACHMENT_DOCUMENT_KIND_LABELS } from "~/lib/email/attachment-document-kind-labels";

function orderIdFromEntityId(entityId: string): number {
  const id = Number.parseInt(entityId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid order id");
  }
  return id;
}

function kindLabel(kind: keyof typeof ATTACHMENT_DOCUMENT_KIND_LABELS): string {
  return ATTACHMENT_DOCUMENT_KIND_LABELS[kind].toLowerCase();
}

export const orderConfirmationEmailHandler: EmailSendContextHandler = {
  async assertCanSend(_auth, entityId) {
    const orderId = orderIdFromEntityId(entityId);
    const order = await getOrder(orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    const customer = order.customerId
      ? await getCustomer(order.customerId)
      : null;
    if (!customer?.email?.trim()) {
      throw new Error("Customer has no email address");
    }
    if (
      await hasBlockingOrderContextSend(
        entityId,
        EMAIL_CONTEXT.ORDER_CONFIRMATION,
      )
    ) {
      throw new Error(
        "A customer confirmation email has already been sent or is in progress for this order.",
      );
    }
  },

  async getRecipientEmail(_auth, entityId) {
    const orderId = orderIdFromEntityId(entityId);
    const order = await getOrder(orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    const customer = order.customerId
      ? await getCustomer(order.customerId)
      : null;
    const email = customer?.email?.trim();
    if (!email) {
      throw new Error("Customer has no email address");
    }
    return email;
  },

  async buildMergeProps(entityId) {
    const tokens = await resolveOrderTokens(entityId);
    const orderNumber = tokens.orderNumber ?? tokens.documentNumber ?? "";
    return {
      ...tokens,
      quoteNumber: orderNumber,
    };
  },

  async verifyAttachmentIds(_auth, entityId, attachmentIds) {
    const orderId = orderIdFromEntityId(entityId);

    const resolved = await resolveEmailTemplateForContext(
      EMAIL_CONTEXT.ORDER_CONFIRMATION,
    );
    if (!resolved) {
      throw new Error(
        "No active email template is configured for order confirmation. Set one in Admin → Email.",
      );
    }

    const required = resolved.template.requiredAttachmentDocumentKinds ?? [];
    if (required.length > 0 && attachmentIds.length === 0) {
      throw new Error(
        "This email template requires at least one attachment. Add the required file(s) before sending.",
      );
    }
    if (required.length === 0 && attachmentIds.length === 0) {
      return;
    }

    const owned = await db
      .select({
        id: orderAttachments.attachmentId,
        documentKind: attachments.documentKind,
      })
      .from(orderAttachments)
      .leftJoin(
        attachments,
        eq(orderAttachments.attachmentId, attachments.id),
      )
      .where(
        and(
          eq(orderAttachments.orderId, orderId),
          inArray(orderAttachments.attachmentId, attachmentIds),
        ),
      );

    if (owned.length !== attachmentIds.length) {
      throw new Error("Invalid attachment selection");
    }

    for (const kind of required) {
      const hasKind = owned.some((r) => r.documentKind === kind);
      if (!hasKind) {
        throw new Error(
          `This email template requires a ${kindLabel(kind)} attachment. Add one before sending.`,
        );
      }
    }
  },

  async afterSent() {
    // Optional: createEvent for order confirmation sent — omitted for minimal scope
  },
};
