import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  businessDaysFrom,
  fromAppCalendarDate,
  parseAppCalendarDateString,
  toAppCalendarDateIsoString,
} from "./business-days";
import { resolveOrderDeliveryFromForm } from "./order-delivery";

describe("resolveOrderDeliveryFromForm", () => {
  const placedAt = fromAppCalendarDate(2026, 6, 1);

  it("parses delivery date string as ET and computes lead time from placement", () => {
    const deliveryDateStr = "2026-06-15";
    const result = resolveOrderDeliveryFromForm({
      deliveryDateStr,
      leadTimeStr: null,
      placedAt,
    });

    expect(result).toBeDefined();
    expect(result!.deliveryDate).not.toBeNull();
    expect(toAppCalendarDateIsoString(result!.deliveryDate as Date)).toBe(
      "2026-06-15"
    );
    expect(result!.leadTime).toBe(
      businessDaysFrom(placedAt, parseAppCalendarDateString(deliveryDateStr))
    );
  });

  it("clears delivery when deliveryDateStr is empty", () => {
    expect(
      resolveOrderDeliveryFromForm({
        deliveryDateStr: "",
        leadTimeStr: null,
        placedAt,
      })
    ).toEqual({ deliveryDate: null, leadTime: null });
  });

  it("derives delivery from lead time anchored on placedAt", () => {
    const result = resolveOrderDeliveryFromForm({
      deliveryDateStr: null,
      leadTimeStr: "10",
      placedAt,
    });

    expect(result).toEqual({
      deliveryDate: addBusinessDays(placedAt, 10),
      leadTime: 10,
    });
  });

  it("returns undefined when no delivery fields submitted", () => {
    expect(
      resolveOrderDeliveryFromForm({
        deliveryDateStr: null,
        leadTimeStr: null,
        placedAt,
      })
    ).toBeUndefined();
  });

  it("prefers deliveryDateStr over leadTimeStr when both present", () => {
    const result = resolveOrderDeliveryFromForm({
      deliveryDateStr: "2026-06-15",
      leadTimeStr: "5",
      placedAt,
    });

    expect(toAppCalendarDateIsoString(result!.deliveryDate as Date)).toBe(
      "2026-06-15"
    );
  });
});
