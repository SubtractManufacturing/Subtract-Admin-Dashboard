/**
 * Parse Quote line-item form posts into validated, typed values. Pure: no I/O,
 * so every pricing rule (percent discounts, part-linked limits) is testable
 * with plain `FormData`.
 */
import { parseLineTotalInput, parseUnitPriceInput } from "~/lib/lineItemPricing";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (formData: FormData, key: string): string | null => {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
};

/** Positive whole number, or null. */
export function parseQuantity(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const qty = parseInt(raw, 10);
  return Number.isNaN(qty) || qty <= 0 ? null : qty;
}

export type QuoteLineItemUpdate = Partial<{
  quantity: number;
  unitPrice: number;
  description: string;
  notes: string;
  name: string;
}>;

/**
 * Fields to change on an existing line item. Only fields present in the form
 * are touched. `totalPrice` wins over `unitPrice` and is converted to a unit price.
 */
export function parseQuoteLineItemUpdate(
  formData: FormData,
  current: {
    quantity: number;
    quotePartId: string | null;
    /** Sum of other positive lines; the base for "% off" entries. */
    positiveSubtotal: number;
  },
): Result<QuoteLineItemUpdate> {
  const update: QuoteLineItemUpdate = {};
  const isPartLinked = current.quotePartId != null;

  const quantityRaw = str(formData, "quantity");
  let qty = current.quantity;
  if (quantityRaw !== null && quantityRaw !== "") {
    const parsed = parseInt(quantityRaw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return { ok: false, error: "Invalid quantity" };
    }
    qty = parsed;
    update.quantity = parsed;
  }

  const totalPriceRaw = str(formData, "totalPrice");
  const unitPriceRaw = str(formData, "unitPrice");
  if (totalPriceRaw !== null && totalPriceRaw !== "") {
    const total = parseLineTotalInput(totalPriceRaw, {
      quantity: qty,
      positiveSubtotal: current.positiveSubtotal,
      isPartLinked,
    });
    if (!total.ok) return { ok: false, error: total.error };
    if (qty <= 0) return { ok: false, error: "Invalid quantity" };
    update.unitPrice = total.totalPrice / qty;
  } else if (unitPriceRaw !== null && unitPriceRaw !== "") {
    const unit = parseUnitPriceInput(unitPriceRaw, {
      quantity: qty,
      positiveSubtotal: current.positiveSubtotal,
      isPartLinked,
    });
    if (!unit.ok) return { ok: false, error: unit.error };
    update.unitPrice = unit.unitPrice;
  }

  const description = str(formData, "description");
  if (description !== null) update.description = description || "";
  const notes = str(formData, "notes");
  if (notes !== null) update.notes = notes || "";
  const name = str(formData, "name");
  if (name !== null) update.name = name.trim();

  return { ok: true, value: update };
}

export type NewQuoteLineItemFields = {
  name: string;
  description: string;
  notes: string;
  quantity: string;
  unitPrice: string;
  material: string | null;
  tolerance: string | null;
  finish: string | null;
  file: File | null;
};

/** Raw fields of the "Add line item" modal (also used by "attach part to line item"). */
export function readNewQuoteLineItemFields(formData: FormData): NewQuoteLineItemFields {
  const file = formData.get("file");
  return {
    name: str(formData, "name") ?? "",
    description: str(formData, "description") ?? "",
    notes: str(formData, "notes") ?? "",
    quantity: str(formData, "quantity") ?? "",
    unitPrice: str(formData, "unitPrice") ?? "",
    material: str(formData, "material") || null,
    tolerance: str(formData, "tolerance") || null,
    finish: str(formData, "finish") || null,
    file: file && typeof file !== "string" ? (file as File) : null,
  };
}
