/**
 * Helpers for manual line-item pricing, including snapshot %-of-subtotal discounts.
 */

export type QuoteLineLike = {
  id: number;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
};

export type OrderLineLike = {
  id: number;
  quantity: number;
  unitPrice: string | null;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function extendedFromQuoteLine(item: QuoteLineLike): number {
  const tp = parseFloat(item.totalPrice || "");
  if (!Number.isNaN(tp)) return tp;
  return (
    (parseFloat(item.unitPrice || "0") || 0) * (item.quantity || 0)
  );
}

export function extendedFromOrderLine(item: OrderLineLike): number {
  return (
    (parseFloat(item.unitPrice || "0") || 0) * (item.quantity || 0)
  );
}

/** Sum of extended amounts strictly greater than zero, optionally excluding one line (e.g. the row being edited). */
export function quotePositiveSubtotalExcluding(
  items: QuoteLineLike[],
  excludeLineItemId?: number
): number {
  return items.reduce((sum, item) => {
    if (excludeLineItemId != null && item.id === excludeLineItemId) {
      return sum;
    }
    const ext = extendedFromQuoteLine(item);
    return ext > 0 ? sum + ext : sum;
  }, 0);
}

export function orderPositiveSubtotalExcluding(
  items: OrderLineLike[],
  excludeLineItemId?: number
): number {
  return items.reduce((sum, item) => {
    if (excludeLineItemId != null && item.id === excludeLineItemId) {
      return sum;
    }
    const ext = extendedFromOrderLine(item);
    return ext > 0 ? sum + ext : sum;
  }, 0);
}

export type ParseUnitPriceContext = {
  quantity: number;
  positiveSubtotal: number;
  isPartLinked: boolean;
};

/**
 * Parse a unit price field. Supports plain numbers and values like "20%" / "-20%":
 * both apply a discount of that percent of `positiveSubtotal`, snapshotted as a negative unit price.
 */
export function parseUnitPriceInput(
  raw: string,
  ctx: ParseUnitPriceContext
): { ok: true; unitPrice: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) {
    return { ok: false, error: "Price is required" };
  }
  if (ctx.isPartLinked && /%/.test(t)) {
    return {
      ok: false,
      error: "Percentage entry is not available on part-linked line items",
    };
  }

  const percentMatch = t.match(/^\s*-?\s*(\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    if (ctx.isPartLinked) {
      return {
        ok: false,
        error: "Percentage entry is not available on part-linked line items",
      };
    }
    const pct = parseFloat(percentMatch[1]);
    if (Number.isNaN(pct) || pct < 0) {
      return { ok: false, error: "Invalid percentage" };
    }
    if (ctx.positiveSubtotal <= 0) {
      return {
        ok: false,
        error:
          "Add priced line items before applying a percentage discount",
      };
    }
    if (ctx.quantity <= 0) {
      return { ok: false, error: "Invalid quantity" };
    }
    const extended = -ctx.positiveSubtotal * (pct / 100);
    const unit = extended / ctx.quantity;
    return { ok: true, unitPrice: roundMoney(unit) };
  }

  const n = parseFloat(t);
  if (Number.isNaN(n)) {
    return { ok: false, error: "Invalid price" };
  }
  if (ctx.isPartLinked && n < 0) {
    return {
      ok: false,
      error: "Part-linked line items cannot have a negative unit price",
    };
  }
  return { ok: true, unitPrice: n };
}

export type ParseLineTotalContext = {
  quantity: number;
  positiveSubtotal: number;
  isPartLinked: boolean;
};

/** Parse a line total (extended price) field; supports "20%" / "-20%" like unit price. */
export function parseLineTotalInput(
  raw: string,
  ctx: ParseLineTotalContext
): { ok: true; totalPrice: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) {
    return { ok: false, error: "Total is required" };
  }
  if (ctx.isPartLinked && /%/.test(t)) {
    return {
      ok: false,
      error: "Percentage entry is not available on part-linked line items",
    };
  }

  const percentMatch = t.match(/^\s*-?\s*(\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    if (ctx.isPartLinked) {
      return {
        ok: false,
        error: "Percentage entry is not available on part-linked line items",
      };
    }
    const pct = parseFloat(percentMatch[1]);
    if (Number.isNaN(pct) || pct < 0) {
      return { ok: false, error: "Invalid percentage" };
    }
    if (ctx.positiveSubtotal <= 0) {
      return {
        ok: false,
        error:
          "Add priced line items before applying a percentage discount",
      };
    }
    const extended = -ctx.positiveSubtotal * (pct / 100);
    return { ok: true, totalPrice: roundMoney(extended) };
  }

  const n = parseFloat(t);
  if (Number.isNaN(n)) {
    return { ok: false, error: "Invalid total" };
  }
  if (ctx.isPartLinked && n < 0) {
    return {
      ok: false,
      error: "Part-linked line items cannot have a negative line total",
    };
  }
  return { ok: true, totalPrice: n };
}
