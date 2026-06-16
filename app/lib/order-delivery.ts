import {
  addBusinessDays,
  type AppInstantInput,
  businessDaysFrom,
  parseAppCalendarDateString,
  toAppCalendarDate,
} from "./business-days";

export type OrderDeliveryFormInput = {
  deliveryDateStr: string | null;
  leadTimeStr: string | null;
  /** order.createdAt for edits; startOfTodayInAppTz() for create */
  placedAt: AppInstantInput;
};

export type OrderDeliveryFormResult =
  | { deliveryDate: Date; leadTime: number }
  | { deliveryDate: null; leadTime: null }
  | undefined;

/** Normalize order placement to ET calendar midnight for lead-time math. */
export function orderPlacementAnchor(placedAt: AppInstantInput): Date {
  return toAppCalendarDate(placedAt);
}

/**
 * Resolve delivery date + lead time from order form fields.
 * Returns undefined when neither field was submitted (no change on update).
 */
export function resolveOrderDeliveryFromForm(
  input: OrderDeliveryFormInput
): OrderDeliveryFormResult {
  const { deliveryDateStr, leadTimeStr, placedAt } = input;
  const anchor = orderPlacementAnchor(placedAt);

  if (deliveryDateStr === "") {
    return { deliveryDate: null, leadTime: null };
  }

  if (deliveryDateStr) {
    const deliveryDate = parseAppCalendarDateString(deliveryDateStr);
    return {
      deliveryDate,
      leadTime: businessDaysFrom(anchor, deliveryDate),
    };
  }

  if (leadTimeStr) {
    const days = parseInt(leadTimeStr, 10);
    if (!isNaN(days) && days >= 0) {
      return {
        deliveryDate: addBusinessDays(anchor, days),
        leadTime: days,
      };
    }
  }

  return undefined;
}
