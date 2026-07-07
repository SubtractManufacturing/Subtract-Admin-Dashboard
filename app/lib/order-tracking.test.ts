import { beforeEach, describe, expect, it, vi } from "vitest";

type TrackingRow = {
  id: number;
  orderId: number;
  trackingNumber: string;
  carrier: string | null;
  carrierDetails: { name: string } | null;
  createdAt: Date;
};

type Condition =
  | { type: "and"; conditions: Condition[] }
  | { type: "eq"; column: { name?: string }; value: unknown }
  | { type: "inArray"; column: { name?: string }; values: unknown[] };

const mocks = vi.hoisted(() => {
  type Row = TrackingRow;
  type TestCondition = Condition | undefined;

  const state = {
    rows: [] as Row[],
    nextId: 1,
  };

  const columnValue = (row: Row, column: { name?: string }) => {
    switch (column.name) {
      case "id":
        return row.id;
      case "order_id":
        return row.orderId;
      case "tracking_number":
        return row.trackingNumber;
      default:
        return undefined;
    }
  };

  const matchesCondition = (row: Row, condition: TestCondition): boolean => {
    if (!condition) return true;
    if (condition.type === "and") {
      return condition.conditions.every((nested) => matchesCondition(row, nested));
    }
    if (condition.type === "eq") {
      return columnValue(row, condition.column) === condition.value;
    }
    if (condition.type === "inArray") {
      return condition.values.includes(columnValue(row, condition.column));
    }
    return false;
  };

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: TestCondition) => ({
        orderBy: vi.fn(async () =>
          state.rows
            .filter((row) => matchesCondition(row, condition))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        ),
      })),
    })),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn(
      (
        values: Array<{
          orderId: number;
          trackingNumber: string;
          carrier?: string | null;
          carrierDetails?: { name: string } | null;
        }>,
      ) => ({
        returning: vi.fn(async () => {
          const inserted = values.map((value) => ({
            id: state.nextId++,
            orderId: value.orderId,
            trackingNumber: value.trackingNumber,
            carrier: value.carrier ?? null,
            carrierDetails: value.carrierDetails ?? null,
            createdAt: new Date(),
          }));
          state.rows.push(...inserted);
          return inserted;
        }),
      }),
    ),
  }));

  const update = vi.fn(() => ({
    set: vi.fn(
      (values: {
        trackingNumber: string;
        carrier?: string | null;
        carrierDetails?: { name: string } | null;
      }) => ({
        where: vi.fn((condition: TestCondition) => ({
          returning: vi.fn(async () => {
            const updated: Row[] = [];
            for (const row of state.rows) {
              if (matchesCondition(row, condition)) {
                row.trackingNumber = values.trackingNumber;
                row.carrier = values.carrier ?? null;
                row.carrierDetails = values.carrierDetails ?? null;
                updated.push(row);
              }
            }
            return updated;
          }),
        })),
      }),
    ),
  }));

  const remove = vi.fn(() => ({
    where: vi.fn((condition: TestCondition) => ({
      returning: vi.fn(async () => {
        const deleted = state.rows.filter((row) =>
          matchesCondition(row, condition),
        );
        state.rows = state.rows.filter(
          (row) => !matchesCondition(row, condition),
        );
        return deleted;
      }),
    })),
  }));

  return {
    state,
    db: {
      select,
      insert,
      update,
      delete: remove,
    },
    createEvent: vi.fn(),
  };
});

vi.mock("./db/index.js", () => ({
  db: mocks.db,
}));

vi.mock("./events.js", () => ({
  createEvent: mocks.createEvent,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]) => ({ type: "and", conditions }),
  asc: (column: { name?: string }) => ({ type: "asc", column }),
  desc: (column: { name?: string }) => ({ type: "desc", column }),
  eq: (column: { name?: string }, value: unknown) => ({
    type: "eq",
    column,
    value,
  }),
  inArray: (column: { name?: string }, values: unknown[]) => ({
    type: "inArray",
    column,
    values,
  }),
  sql: vi.fn(),
}));

import {
  addTrackingNumbers,
  deleteTrackingNumbers,
  getTrackingNumbersByOrderId,
  hasTrackingNumbers,
  updateTrackingNumbers,
} from "./order-tracking";
import { detectCarrier } from "./carriers";

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.nextId = 1;
  vi.clearAllMocks();
});

describe("order tracking numbers", () => {
  it("adds multiple tracking numbers at once after trimming input", async () => {
    const rows = await addTrackingNumbers(
      42,
      [
        { trackingNumber: "  1Z999  " },
        { trackingNumber: "" },
        { trackingNumber: "940011" },
      ],
      { userId: "user-1", userEmail: "ops@example.com" },
    );

    expect(rows.map((row) => row.trackingNumber)).toEqual(["1Z999", "940011"]);
    expect(await getTrackingNumbersByOrderId(42)).toHaveLength(2);
    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "order",
        entityId: "42",
        eventType: "tracking_numbers_added",
        metadata: expect.objectContaining({
          trackingNumbers: expect.arrayContaining([
            expect.objectContaining({ trackingNumber: "1Z999" }),
            expect.objectContaining({ trackingNumber: "940011" }),
          ]),
        }),
      }),
    );
  });

  it("stores carrier and carrierDetails when provided", async () => {
    const rows = await addTrackingNumbers(42, [
      { trackingNumber: "1Z999AA10123456784", carrier: "UPS", carrierDetails: null },
    ]);

    expect(rows[0].carrier).toBe("UPS");
    expect(rows[0].carrierDetails).toBeNull();
  });

  it("stores OTHER carrier with carrierDetails name", async () => {
    const rows = await addTrackingNumbers(42, [
      {
        trackingNumber: "XYZ123",
        carrier: "OTHER",
        carrierDetails: { name: "Joe's Freight" },
      },
    ]);

    expect(rows[0].carrier).toBe("OTHER");
    expect(rows[0].carrierDetails).toEqual({ name: "Joe's Freight" });
  });

  it("carrier metadata is included in the added event", async () => {
    await addTrackingNumbers(42, [
      { trackingNumber: "1Z999AA10123456784", carrier: "UPS", carrierDetails: null },
    ]);

    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          trackingNumbers: expect.arrayContaining([
            expect.objectContaining({ carrier: "UPS", carrierDetails: null }),
          ]),
        }),
      }),
    );
  });

  it("rejects duplicate tracking numbers already linked to the same order", async () => {
    await addTrackingNumbers(42, [{ trackingNumber: "1Z999" }]);

    await expect(
      addTrackingNumbers(42, [{ trackingNumber: "1Z999" }]),
    ).rejects.toThrow(/already exists/i);

    expect(await getTrackingNumbersByOrderId(42)).toHaveLength(1);
  });

  it("deletes tracking numbers only when they belong to the order", async () => {
    const [owned] = await addTrackingNumbers(42, [{ trackingNumber: "1Z999" }]);
    const [otherOrder] = await addTrackingNumbers(7, [{ trackingNumber: "940011" }]);

    await deleteTrackingNumbers(42, [owned.id]);

    expect((await getTrackingNumbersByOrderId(42)).map((row) => row.id)).toEqual(
      [],
    );
    expect((await getTrackingNumbersByOrderId(7)).map((row) => row.id)).toEqual([
      otherOrder.id,
    ]);
  });

  it("rejects deleting tracking numbers from another order", async () => {
    const [otherOrder] = await addTrackingNumbers(7, [{ trackingNumber: "940011" }]);

    await expect(deleteTrackingNumbers(42, [otherOrder.id])).rejects.toThrow(
      /belong to this order/i,
    );
  });

  it("reports whether an order has tracking numbers", async () => {
    await expect(hasTrackingNumbers(42)).resolves.toBe(false);

    await addTrackingNumbers(42, [{ trackingNumber: "1Z999" }]);

    await expect(hasTrackingNumbers(42)).resolves.toBe(true);
  });

  it("updates existing tracking numbers in place", async () => {
    const [row] = await addTrackingNumbers(42, [{ trackingNumber: "1Z999" }]);

    const updated = await updateTrackingNumbers(42, [
      { id: row.id, trackingNumber: "  1Z999-CORRECTED  " },
    ]);

    expect(updated.map((r) => r.trackingNumber)).toEqual(["1Z999-CORRECTED"]);
    expect(
      (await getTrackingNumbersByOrderId(42)).map((r) => r.trackingNumber),
    ).toEqual(["1Z999-CORRECTED"]);
    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "tracking_numbers_updated" }),
    );
  });

  it("updates carrier only without changing tracking number", async () => {
    const [row] = await addTrackingNumbers(42, [
      { trackingNumber: "1Z999", carrier: null },
    ]);

    const updated = await updateTrackingNumbers(42, [
      { id: row.id, trackingNumber: "1Z999", carrier: "UPS" },
    ]);

    expect(updated).toHaveLength(1);
    expect(updated[0].carrier).toBe("UPS");
  });

  it("records before/after carrier in update event metadata", async () => {
    const [row] = await addTrackingNumbers(42, [
      { trackingNumber: "1Z999", carrier: "FEDEX" },
    ]);

    await updateTrackingNumbers(42, [
      { id: row.id, trackingNumber: "1Z999", carrier: "UPS" },
    ]);

    expect(mocks.createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: "tracking_numbers_updated",
        metadata: expect.objectContaining({
          updates: expect.arrayContaining([
            expect.objectContaining({
              previous: expect.objectContaining({ carrier: "FEDEX" }),
              next: expect.objectContaining({ carrier: "UPS" }),
            }),
          ]),
        }),
      }),
    );
  });

  it("records before/after carrierDetails in update event metadata", async () => {
    const [row] = await addTrackingNumbers(42, [
      {
        trackingNumber: "XYZ123",
        carrier: "OTHER",
        carrierDetails: { name: "Old Freight" },
      },
    ]);

    await updateTrackingNumbers(42, [
      {
        id: row.id,
        trackingNumber: "XYZ123",
        carrier: "OTHER",
        carrierDetails: { name: "New Freight" },
      },
    ]);

    expect(mocks.createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          updates: expect.arrayContaining([
            expect.objectContaining({
              previous: expect.objectContaining({
                carrierDetails: { name: "Old Freight" },
              }),
              next: expect.objectContaining({
                carrierDetails: { name: "New Freight" },
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it("skips rows whose tracking number and carrier did not change", async () => {
    const [row] = await addTrackingNumbers(42, [
      { trackingNumber: "1Z999", carrier: "UPS" },
    ]);

    const result = await updateTrackingNumbers(42, [
      { id: row.id, trackingNumber: "1Z999", carrier: "UPS" },
    ]);

    expect(result).toEqual([]);
  });

  it("rejects updating a tracking number to one already on the order", async () => {
    const [row1, row2] = await addTrackingNumbers(42, [
      { trackingNumber: "1Z999" },
      { trackingNumber: "940011" },
    ]);

    await expect(
      updateTrackingNumbers(42, [{ id: row1.id, trackingNumber: "940011" }]),
    ).rejects.toThrow(/already exists/i);

    expect(
      (await getTrackingNumbersByOrderId(42)).map((r) => r.trackingNumber),
    ).toEqual([row1.trackingNumber, row2.trackingNumber]);
  });

  it("rejects updating a tracking number that belongs to another order", async () => {
    const [otherOrder] = await addTrackingNumbers(7, [{ trackingNumber: "940011" }]);

    await expect(
      updateTrackingNumbers(42, [
        { id: otherOrder.id, trackingNumber: "1Z999" },
      ]),
    ).rejects.toThrow(/belong to this order/i);
  });
});

describe("detectCarrier", () => {
  it("detects UPS from 1Z prefix", () => {
    expect(detectCarrier("1Z999AA10123456784")).toBe("UPS");
    expect(detectCarrier("1z999AA10123456784")).toBe("UPS");
  });

  it("detects USPS from 94 service-indicator prefix", () => {
    expect(detectCarrier("9400111899223397670009")).toBe("USPS");
    expect(detectCarrier("9261290100830368622798")).toBe("USPS");
  });

  it("detects USPS international format", () => {
    expect(detectCarrier("EA123456789US")).toBe("USPS");
    expect(detectCarrier("LZ123456789CN")).not.toBe("UPS");
  });

  it("detects FedEx 12-digit", () => {
    expect(detectCarrier("123456789012")).toBe("FEDEX");
  });

  it("detects FedEx 15-digit", () => {
    expect(detectCarrier("123456789012345")).toBe("FEDEX");
  });

  it("detects FedEx SmartPost 96 prefix 22-digit", () => {
    expect(detectCarrier("9612345678901234567890")).toBe("FEDEX");
  });

  it("detects DHL JD prefix", () => {
    expect(detectCarrier("JD014600006161590967")).toBe("DHL");
  });

  it("detects DHL 10-digit", () => {
    expect(detectCarrier("1234567890")).toBe("DHL");
  });

  it("detects OnTrac C prefix 15 chars", () => {
    expect(detectCarrier("C12345678901234")).toBe("ONTRAC");
  });

  it("returns null for empty string", () => {
    expect(detectCarrier("")).toBeNull();
    expect(detectCarrier("   ")).toBeNull();
  });

  it("returns null for unrecognized format", () => {
    expect(detectCarrier("UNKNOWN-FORMAT-123")).toBeNull();
  });

  it("never returns OTHER", () => {
    const results = [
      "1Z999AA10123456784",
      "9400111899223397670009",
      "123456789012",
      "UNKNOWN",
    ].map(detectCarrier);
    expect(results.every((r) => r !== "OTHER")).toBe(true);
  });
});
