/**
 * What happens when someone edits one cell of an Order line item inline: the
 * form fields to post, or the reason the edit is refused.
 *
 * Pure and client-safe. Unlike a Quote, an Order line stores no line total, so
 * the whole row is posted each time and the server recomputes the totals.
 */
import {
  orderPositiveSubtotalExcluding,
  parseUnitPriceInput,
} from "~/lib/lineItemPricing";

export type LineItemEditField =
  | "name"
  | "description"
  | "notes"
  | "quantity"
  | "unitPrice"
  | "totalPrice";

export type EditableOrderLine = {
  id: number;
  partId: string | null;
  name: string | null;
  description: string | null;
  notes: string | null;
  quantity: number;
  unitPrice: string | null;
};

export type OrderLineEditPlan =
  /** Unknown line: nothing to do. */
  | { kind: "ignore" }
  /** Tell the person why the edit was refused. */
  | { kind: "reject"; message: string }
  /** Post `fields` to the `updateLineItem` intent. */
  | { kind: "save"; fields: Record<string, string> };

export function planOrderLineItemEdit(
  lines: readonly EditableOrderLine[],
  lineItemId: number,
  field: LineItemEditField,
  value: string,
): OrderLineEditPlan {
  const existing = lines.find((line) => line.id === lineItemId);
  if (!existing) return { kind: "ignore" };

  if (field === "name" && !value.trim()) {
    return { kind: "reject", message: "Name is required" };
  }

  // An unusable quantity keeps the stored one rather than failing the save.
  const quantity =
    field === "quantity" ? parseInt(value, 10) || existing.quantity : existing.quantity;

  let unitPrice = existing.unitPrice || "0";
  if (field === "unitPrice") {
    const parsed = parseUnitPriceInput(value.trim(), {
      quantity,
      // Discount lines are capped by what the other lines add up to.
      positiveSubtotal: orderPositiveSubtotalExcluding(
        lines.map((line) => ({
          id: line.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? "0",
        })),
        lineItemId,
      ),
      isPartLinked: !!existing.partId,
    });
    if (!parsed.ok) return { kind: "reject", message: parsed.error };
    unitPrice = parsed.unitPrice.toFixed(2);
  }

  const fields: Record<string, string> = {
    intent: "updateLineItem",
    lineItemId: lineItemId.toString(),
    name: field === "name" ? value.trim() : existing.name || "",
    description: field === "description" ? value : existing.description || "",
    notes: field === "notes" ? value : existing.notes || "",
    quantity: quantity.toString(),
    unitPrice,
  };
  if (existing.partId) fields.partId = existing.partId;

  return { kind: "save", fields };
}

/**
 * True while any line's part is still being converted to a mesh, including a
 * part with a CAD file whose conversion has not been recorded yet.
 */
export function hasConvertingOrderParts(
  parts: ReadonlyArray<{
    meshConversionStatus?: string | null;
    partFileUrl?: string | null;
  } | null>,
): boolean {
  return parts.some((part) => {
    if (!part) return false;
    return (
      part.meshConversionStatus === "in_progress" ||
      part.meshConversionStatus === "queued" ||
      part.meshConversionStatus === "pending" ||
      (!!part.partFileUrl && !part.meshConversionStatus)
    );
  });
}
