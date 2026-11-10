/**
 * Quote line-item intents: add (optionally with a part upload), attach a part
 * to an existing line, edit, archive and restore.
 */
import { json } from "@remix-run/node";
import {
  parseUnitPriceInput,
  quotePositiveSubtotalExcluding,
} from "~/lib/lineItemPricing";
import {
  badRequest,
  notFound,
  serverError,
  type IntentTable,
} from "~/lib/route-actions/core";
import { ensureDraft, redirectToQuote, type QuoteCtx } from "../context";
import {
  parseQuantity,
  parseQuoteLineItemUpdate,
  readNewQuoteLineItemFields,
} from "../line-item-form";
import { createQuotePartFromUpload } from "../part-intake";
import type { QuoteDeps } from "../ports";

type Ctx = QuoteCtx<
  Pick<
    QuoteDeps,
    "quotes" | "lineItems" | "parts" | "files" | "events" | "drawingUploads" | "ids"
  >
>;

const toId = (raw: FormDataEntryValue | null): number | null => {
  if (raw === null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
};

/**
 * "Add line item" and "Attach part to this line item" share one form and one
 * flow, differing only in whether a line already exists.
 */
async function addOrPromoteLineItem(
  ctx: Ctx,
  formData: FormData,
  promote: boolean,
): Promise<Response> {
  await ensureDraft(ctx);

  const fields = readNewQuoteLineItemFields(formData);
  if (!fields.name || !fields.quantity || !fields.unitPrice) {
    return badRequest("Missing required fields");
  }

  const file = fields.file && fields.file.size > 0 ? fields.file : null;

  let promoteLineItemId: number | null = null;
  if (promote) {
    const rawId = formData.get("lineItemId");
    if (!rawId) return badRequest("Line item ID is required");
    promoteLineItemId = toId(rawId);
    if (promoteLineItemId === null) return badRequest("Invalid line item ID");

    const existing = await ctx.deps.lineItems.find(promoteLineItemId);
    if (!existing || existing.quoteId !== ctx.quote.id) {
      return notFound("Line item not found");
    }
    if (existing.quotePartId) {
      return badRequest("This line item already has an attached part");
    }
    if (!file) {
      return badRequest(
        "Upload a CAD file or drawing to attach a part to this line item",
      );
    }
  }

  try {
    // Validate quantity and price before any file is stored or part created,
    // so a typo cannot leave an orphaned part behind.
    const quantity = parseQuantity(fields.quantity);
    if (quantity === null) return badRequest("Invalid quantity");

    const positiveSubtotal = promote
      ? 0
      : quotePositiveSubtotalExcluding(
          await ctx.deps.lineItems.list(ctx.quote.id, "all"),
        );
    const unit = parseUnitPriceInput(fields.unitPrice, {
      quantity,
      positiveSubtotal,
      isPartLinked: promote || !!file,
    });
    if (!unit.ok) return badRequest(unit.error);

    let quotePartId: string | null = null;
    if (file) {
      const created = await createQuotePartFromUpload(ctx, file, fields, formData);
      if (!created.ok) return created.response;
      quotePartId = created.quotePartId;
    }

    if (promote && promoteLineItemId !== null) {
      await ctx.deps.lineItems.linkToPart(promoteLineItemId, {
        quotePartId,
        name: fields.name.trim() || null,
        description: fields.description.trim() || null,
        notes: fields.notes.trim() || null,
        quantity,
        unitPrice: unit.unitPrice.toFixed(2),
        totalPrice: (quantity * unit.unitPrice).toFixed(2),
      });
      await ctx.deps.events.create({
        entityType: "quote",
        entityId: String(ctx.quote.id),
        eventType: "quote_line_item_updated",
        eventCategory: "financial",
        title: "Line Item Linked to Part",
        description: `Attached a manufacturing part to line item ${
          fields.name.trim() || promoteLineItemId
        }`,
        metadata: { lineItemId: promoteLineItemId, quotePartId },
        userId: ctx.actor.userId,
        userEmail: ctx.actor.userEmail,
      });
    } else {
      await ctx.deps.lineItems.create(
        ctx.quote.id,
        {
          quotePartId: quotePartId || undefined,
          name: fields.name || undefined,
          quantity,
          unitPrice: unit.unitPrice,
          description: fields.description || undefined,
          notes: fields.notes || undefined,
        },
        ctx.actor,
      );
    }

    await ctx.deps.quotes.recalculateTotals(ctx.quote.id);
    return redirectToQuote(ctx.quote);
  } catch (error) {
    console.error("Error adding line item:", error);
    return serverError("Failed to add line item");
  }
}

export const lineItemIntents: IntentTable<Ctx> = {
  addLineItem: (ctx, formData) => addOrPromoteLineItem(ctx, formData, false),
  promoteLineItemToQuotePart: (ctx, formData) =>
    addOrPromoteLineItem(ctx, formData, true),

  async updateLineItem(ctx, formData) {
    await ensureDraft(ctx);

    const rawId = formData.get("lineItemId");
    if (!rawId) return badRequest("Missing line item ID");
    const lineItemId = toId(rawId);
    if (lineItemId === null) return badRequest("Invalid line item ID");

    const line = await ctx.deps.lineItems.find(lineItemId);
    if (!line || line.quoteId !== ctx.quote.id) {
      return notFound("Line item not found");
    }

    const activeLines = await ctx.deps.lineItems.list(ctx.quote.id, "active");
    const parsed = parseQuoteLineItemUpdate(formData, {
      quantity: line.quantity,
      quotePartId: line.quotePartId,
      positiveSubtotal: quotePositiveSubtotalExcluding(activeLines, lineItemId),
    });
    if (!parsed.ok) return badRequest(parsed.error);

    await ctx.deps.lineItems.update(lineItemId, parsed.value, ctx.actor);
    const totals = await ctx.deps.quotes.recalculateTotals(ctx.quote.id);
    return json({ success: true, totals });
  },

  async archiveLineItem(ctx, formData) {
    await ensureDraft(ctx);

    const rawId = formData.get("lineItemId");
    if (!rawId) return badRequest("Missing line item ID");
    const lineItemId = toId(rawId);
    if (lineItemId === null) return badRequest("Invalid line item ID");

    try {
      await ctx.deps.lineItems.archive(lineItemId, ctx.quote.id, ctx.actor);
      return redirectToQuote(ctx.quote);
    } catch (error) {
      console.error("Error archiving line item:", error);
      return serverError(
        error instanceof Error ? error.message : "Failed to archive line item",
      );
    }
  },

  async restoreLineItem(ctx, formData) {
    const rawId = formData.get("lineItemId");
    if (!rawId) return badRequest("Missing line item ID");
    const lineItemId = toId(rawId);
    if (lineItemId === null) return badRequest("Invalid line item ID");

    try {
      await ctx.deps.lineItems.restore(lineItemId, ctx.quote.id, ctx.actor);
      return redirectToQuote(ctx.quote);
    } catch (error) {
      console.error("Error restoring line item:", error);
      return serverError(
        error instanceof Error ? error.message : "Failed to restore line item",
      );
    }
  },
};
