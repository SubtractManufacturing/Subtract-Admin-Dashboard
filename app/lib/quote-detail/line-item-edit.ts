/**
 * What happens when someone edits one cell of a Quote line item inline: the
 * optimistic change to show immediately and the form fields to post.
 *
 * Pure and client-safe. Quantity, unit price and line total are kept consistent
 * here (editing one recomputes the others) so the page only applies the plan.
 */
import {
  parseLineTotalInput,
  parseUnitPriceInput,
  quotePositiveSubtotalExcluding,
} from "~/lib/lineItemPricing";

export type LineItemEditField =
  | "name"
  | "description"
  | "notes"
  | "quantity"
  | "unitPrice"
  | "totalPrice";

export type EditableQuoteLine = {
  id: number;
  quotePartId: string | null;
  name: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  description: string | null;
  notes: string | null;
};

export type QuoteLinePatch = Partial<
  Pick<
    EditableQuoteLine,
    "name" | "description" | "notes" | "quantity" | "unitPrice" | "totalPrice"
  >
>;

export type QuoteLineEditPlan =
  /** Unknown line or an unusable number: leave the cell as it was. */
  | { kind: "ignore" }
  /** Tell the person why the edit was refused. */
  | { kind: "reject"; message: string }
  /** Apply `patch` optimistically and post `fields` to the `updateLineItem` intent. */
  | { kind: "save"; patch: QuoteLinePatch; fields: Record<string, string> };

export function planQuoteLineItemEdit(
  items: readonly EditableQuoteLine[],
  lineItemId: number,
  field: LineItemEditField,
  value: string,
): QuoteLineEditPlan {
  const current = items.find((item) => item.id === lineItemId);
  if (!current) return { kind: "ignore" };

  const patch: QuoteLinePatch = {};

  if (field === "name") {
    const trimmed = value.trim();
    if (!trimmed) return { kind: "reject", message: "Name is required" };
    patch.name = trimmed;
  }
  if (field === "description") patch.description = value || null;
  if (field === "notes") patch.notes = value || null;

  if (field === "quantity") {
    const quantity = parseInt(value, 10);
    if (Number.isNaN(quantity) || quantity <= 0) return { kind: "ignore" };
    patch.quantity = quantity;
    patch.totalPrice = (quantity * parseFloat(current.unitPrice || "0")).toFixed(2);
  }

  // Discount lines are capped by what the other lines add up to.
  const pricingContext = {
    quantity: current.quantity,
    positiveSubtotal: quotePositiveSubtotalExcluding(
      items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
      lineItemId,
    ),
    isPartLinked: current.quotePartId != null,
  };

  if (field === "unitPrice") {
    const parsed = parseUnitPriceInput(value, pricingContext);
    if (!parsed.ok) return { kind: "ignore" };
    patch.unitPrice = parsed.unitPrice.toFixed(2);
    patch.totalPrice = (current.quantity * parsed.unitPrice).toFixed(2);
  }

  if (field === "totalPrice") {
    const parsed = parseLineTotalInput(value, pricingContext);
    if (!parsed.ok) return { kind: "ignore" };
    patch.totalPrice = parsed.totalPrice.toFixed(2);
    if (current.quantity > 0) {
      patch.unitPrice = (parsed.totalPrice / current.quantity).toFixed(2);
    }
  }

  const fields: Record<string, string> = {
    intent: "updateLineItem",
    lineItemId: lineItemId.toString(),
  };
  if (patch.name !== undefined) fields.name = patch.name ?? "";
  if (patch.description !== undefined) fields.description = patch.description || "";
  if (patch.notes !== undefined) fields.notes = patch.notes || "";
  if (patch.quantity !== undefined) fields.quantity = patch.quantity.toString();
  if (patch.unitPrice !== undefined) fields.unitPrice = patch.unitPrice;
  if (patch.totalPrice !== undefined) fields.totalPrice = patch.totalPrice;

  return { kind: "save", patch, fields };
}

/** True while any part's mesh conversion is still running (the page polls until it is not). */
export function hasConvertingQuoteParts(
  parts: ReadonlyArray<{ conversionStatus: string | null }> | null | undefined,
): boolean {
  return !!parts?.some(
    (part) =>
      part.conversionStatus === "in_progress" ||
      part.conversionStatus === "queued" ||
      part.conversionStatus === "pending",
  );
}
