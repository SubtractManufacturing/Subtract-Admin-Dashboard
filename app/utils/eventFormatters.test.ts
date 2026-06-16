import { describe, expect, it } from "vitest";
import type { EventLog } from "~/lib/events";
import { formatEventForTimeline } from "./eventFormatters";

function makeOrderUpdatedEvent(
  metadata: Record<string, unknown>
): EventLog {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    entityType: "order",
    entityId: "1",
    eventType: "order_updated",
    eventCategory: "status",
    title: "Order Updated",
    description: null,
    metadata,
    userId: null,
    userEmail: null,
    ipAddress: null,
    userAgent: null,
    isDismissed: false,
    dismissedAt: null,
    dismissedBy: null,
    createdAt: new Date(),
  };
}

describe("formatEventForTimeline delivery date fields", () => {
  it("formats deliveryDate updates", () => {
    const result = formatEventForTimeline(
      makeOrderUpdatedEvent({
        updatedFields: ["deliveryDate"],
        changes: {
          deliveryDate: {
            old: "2026-01-01T00:00:00.000Z",
            new: "2026-01-15T00:00:00.000Z",
          },
        },
      })
    );
    expect(result.title).toBe("Delivery Date Updated");
    expect(result.description).toContain("→");
  });

  it("formats legacy shipDate updates (v1.4.2 and earlier)", () => {
    const result = formatEventForTimeline(
      makeOrderUpdatedEvent({
        updatedFields: ["shipDate"],
        changes: {
          shipDate: {
            old: null,
            new: "2026-02-01T00:00:00.000Z",
          },
        },
      })
    );
    expect(result.title).toBe("Delivery Date Updated");
  });
});
