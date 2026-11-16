/**
 * Order line-item intents: create (optionally with an uploaded part), edit,
 * edit notes, archive and restore.
 */
import { json } from "@remix-run/node";
import {
  orderPositiveSubtotalExcluding,
  parseUnitPriceInput,
} from "~/lib/lineItemPricing";
import {
  badRequest,
  notFound,
  serverError,
  type IntentTable,
} from "~/lib/route-actions/core";
import {
  collectDrawingFiles,
  sanitizeUploadFileName,
  uploadDrawings,
} from "~/lib/route-actions/drawing-uploads";
import type { OrderCtx } from "../context";
import type { OrderDeps } from "../ports";

type Ctx = OrderCtx<
  Pick<OrderDeps, "lineItems" | "parts" | "files" | "drawingUploads">
>;

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const int = (formData: FormData, key: string): number =>
  parseInt(text(formData, key), 10);

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** `partId` field: blank means no part; an absent field means "leave as is". */
function readPartId(formData: FormData): string | null | undefined {
  if (!formData.has("partId")) return undefined;
  const raw = text(formData, "partId").trim();
  return raw || null;
}

export const lineItemIntents: IntentTable<Ctx> = {
  async createLineItem(ctx, formData) {
    const name = text(formData, "name");
    const description = text(formData, "description");
    const quantity = int(formData, "quantity");
    const unitPriceRaw = text(formData, "unitPrice");
    const notes = text(formData, "notes");
    const partId = readPartId(formData) ?? null;

    if (!name || !quantity || !unitPriceRaw) return badRequest("Missing required fields");

    const unit = parseUnitPriceInput(unitPriceRaw.trim(), {
      quantity,
      positiveSubtotal: orderPositiveSubtotalExcluding(
        await ctx.deps.lineItems.list(ctx.order.id),
      ),
      isPartLinked: !!partId,
    });
    if (!unit.ok) return badRequest(unit.error);

    try {
      const lineItem = await ctx.deps.lineItems.create(
        {
          orderId: ctx.order.id,
          name,
          description,
          quantity,
          unitPrice: unit.unitPrice.toFixed(2),
          partId,
          notes: notes || null,
        },
        ctx.actor,
      );
      return json({ lineItem });
    } catch (error) {
      return badRequest(errorMessage(error, "Failed to create line item"));
    }
  },

  /** Add a line for a brand-new Part: stores the CAD file and any drawings first. */
  async createLineItemWithUpload(ctx, formData) {
    const name = text(formData, "name");
    const description = text(formData, "description");
    const quantity = int(formData, "quantity");
    const unitPriceRaw = text(formData, "unitPrice");
    const notes = text(formData, "notes");
    const file = formData.get("file");
    const customerId = ctx.order.customerId;

    if (
      !name ||
      !quantity ||
      !unitPriceRaw ||
      !file ||
      typeof file === "string" ||
      !customerId
    ) {
      return badRequest("Missing required fields");
    }

    try {
      // Price first: a bad entry must not leave an orphaned part or stored file.
      const unit = parseUnitPriceInput(unitPriceRaw.trim(), {
        quantity,
        positiveSubtotal: orderPositiveSubtotalExcluding(
          await ctx.deps.lineItems.list(ctx.order.id),
        ),
        isPartLinked: true,
      });
      if (!unit.ok) return badRequest(unit.error);

      const safeName = sanitizeUploadFileName(file.name);
      const stored = await ctx.deps.files.upload({
        key: `parts/${Date.now()}-${safeName}`,
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
        fileName: safeName,
      });

      const part = await ctx.deps.parts.create(
        {
          customerId,
          partName: name,
          notes: text(formData, "partNotes") || null,
          material: text(formData, "material") || null,
          tolerance: text(formData, "tolerance") || null,
          finishing: text(formData, "finish") || null,
          partFileUrl: stored.key,
        },
        ctx.actor,
      );

      await uploadDrawings(ctx.deps.drawingUploads, {
        drawings: collectDrawingFiles(formData),
        keyPrefix: `parts/${part.id}/drawings`,
        link: (attachmentId) => ctx.deps.parts.linkDrawing(part.id, attachmentId),
      });

      const lineItem = await ctx.deps.lineItems.create(
        {
          orderId: ctx.order.id,
          name,
          description,
          quantity,
          unitPrice: unit.unitPrice.toFixed(2),
          partId: part.id,
          notes: notes || null,
        },
        ctx.actor,
      );
      return json({ lineItem });
    } catch (error) {
      console.error("createLineItemWithUpload error:", error);
      return serverError("Failed to create line item with uploaded part");
    }
  },

  async updateLineItem(ctx, formData) {
    const lineItemId = int(formData, "lineItemId");
    const name = text(formData, "name");
    const description = text(formData, "description");
    const quantity = int(formData, "quantity");
    const unitPriceRaw = text(formData, "unitPrice");
    const notes = text(formData, "notes");
    const partId = readPartId(formData);

    if (!lineItemId || !name || !quantity || !unitPriceRaw) {
      return badRequest("Missing required fields");
    }

    const line = await ctx.deps.lineItems.find(lineItemId);
    if (!line || line.orderId !== ctx.order.id) return notFound("Line item not found");

    const unit = parseUnitPriceInput(unitPriceRaw.trim(), {
      quantity,
      positiveSubtotal: orderPositiveSubtotalExcluding(
        await ctx.deps.lineItems.list(ctx.order.id),
        lineItemId,
      ),
      isPartLinked: !!(partId !== undefined ? partId : line.partId),
    });
    if (!unit.ok) return badRequest(unit.error);

    try {
      const lineItem = await ctx.deps.lineItems.update(
        lineItemId,
        {
          name,
          description,
          quantity,
          unitPrice: unit.unitPrice.toFixed(2),
          ...(partId !== undefined ? { partId } : {}),
          notes: notes || null,
        },
        ctx.actor,
      );
      return json({ lineItem });
    } catch (error) {
      return badRequest(errorMessage(error, "Failed to update line item"));
    }
  },

  async updateLineItemNote(ctx, formData) {
    const lineItemId = int(formData, "lineItemId");
    if (!lineItemId) return badRequest("Missing line item ID");

    const lineItem = await ctx.deps.lineItems.update(
      lineItemId,
      { notes: text(formData, "notes") || null },
      ctx.actor,
    );
    return json({ lineItem });
  },

  async archiveLineItem(ctx, formData) {
    const lineItemId = int(formData, "lineItemId");
    if (!lineItemId) return badRequest("Missing line item ID");

    try {
      await ctx.deps.lineItems.archive(lineItemId, ctx.order.id, ctx.actor);
      return json({ success: true });
    } catch (error) {
      return serverError(errorMessage(error, "Failed to archive line item"));
    }
  },

  async restoreLineItem(ctx, formData) {
    const lineItemId = int(formData, "lineItemId");
    if (!lineItemId) return badRequest("Missing line item ID");

    try {
      await ctx.deps.lineItems.restore(lineItemId, ctx.order.id, ctx.actor);
      return json({ success: true });
    } catch (error) {
      return serverError(errorMessage(error, "Failed to restore line item"));
    }
  },
};
