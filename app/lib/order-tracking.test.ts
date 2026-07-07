import { beforeEach, describe, expect, it, vi } from "vitest";

type TrackingRow = {
  id: number;
  orderId: number;
  trackingNumber: string;
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
    values: vi.fn((values: Array<{ orderId: number; trackingNumber: string }>) => ({
      returning: vi.fn(async () => {
        const inserted = values.map((value) => ({
          id: state.nextId++,
          orderId: value.orderId,
          trackingNumber: value.trackingNumber,
          createdAt: new Date(),
        }));
        state.rows.push(...inserted);
        return inserted;
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((values: { trackingNumber: string }) => ({
      where: vi.fn((condition: TestCondition) => ({
        returning: vi.fn(async () => {
          const updated: Row[] = [];
          for (const row of state.rows) {
            if (matchesCondition(row, condition)) {
              row.trackingNumber = values.trackingNumber;
              updated.push(row);
            }
          }
          return updated;
        }),
      })),
    })),
  }));

  const remove = vi.fn(() => ({
    where: vi.fn((condition: TestCondition) => ({
      returning: vi.fn(async () => {
        const deleted = state.rows.filter((row) =>
          matchesCondition(row, condition),
        );
        state.rows = state.rows.filter((row) => !matchesCondition(row, condition));
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

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.nextId = 1;
  vi.clearAllMocks();
});

describe("order tracking numbers", () => {
  it("adds multiple tracking numbers at once after trimming input", async () => {
    const rows = await addTrackingNumbers(42, ["  1Z999  ", "", "940011"], {
      userId: "user-1",
      userEmail: "ops@example.com",
    });

    expect(rows.map((row) => row.trackingNumber)).toEqual(["1Z999", "940011"]);
    expect(await getTrackingNumbersByOrderId(42)).toHaveLength(2);
    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "order",
        entityId: "42",
        eventType: "tracking_numbers_added",
        metadata: expect.objectContaining({
          trackingNumbers: ["1Z999", "940011"],
        }),
      }),
    );
  });

  it("rejects duplicate tracking numbers already linked to the same order", async () => {
    await addTrackingNumbers(42, ["1Z999"]);

    await expect(addTrackingNumbers(42, ["1Z999"])).rejects.toThrow(
      /already exists/i,
    );

    expect(await getTrackingNumbersByOrderId(42)).toHaveLength(1);
  });

  it("deletes tracking numbers only when they belong to the order", async () => {
    const [owned] = await addTrackingNumbers(42, ["1Z999"]);
    const [otherOrder] = await addTrackingNumbers(7, ["940011"]);

    await deleteTrackingNumbers(42, [owned.id]);

    expect((await getTrackingNumbersByOrderId(42)).map((row) => row.id)).toEqual(
      [],
    );
    expect((await getTrackingNumbersByOrderId(7)).map((row) => row.id)).toEqual([
      otherOrder.id,
    ]);
  });

  it("rejects deleting tracking numbers from another order", async () => {
    const [otherOrder] = await addTrackingNumbers(7, ["940011"]);

    await expect(deleteTrackingNumbers(42, [otherOrder.id])).rejects.toThrow(
      /belong to this order/i,
    );
  });

  it("reports whether an order has tracking numbers", async () => {
    await expect(hasTrackingNumbers(42)).resolves.toBe(false);

    await addTrackingNumbers(42, ["1Z999"]);

    await expect(hasTrackingNumbers(42)).resolves.toBe(true);
  });

  it("updates existing tracking numbers in place", async () => {
    const [row] = await addTrackingNumbers(42, ["1Z999"]);

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

  it("skips rows whose tracking number did not change", async () => {
    const [row] = await addTrackingNumbers(42, ["1Z999"]);

    const result = await updateTrackingNumbers(42, [
      { id: row.id, trackingNumber: "1Z999" },
    ]);

    expect(result).toEqual([]);
  });

  it("rejects updating a tracking number to one already on the order", async () => {
    const [row1, row2] = await addTrackingNumbers(42, ["1Z999", "940011"]);

    await expect(
      updateTrackingNumbers(42, [{ id: row1.id, trackingNumber: "940011" }]),
    ).rejects.toThrow(/already exists/i);

    expect(
      (await getTrackingNumbersByOrderId(42)).map((r) => r.trackingNumber),
    ).toEqual([row1.trackingNumber, row2.trackingNumber]);
  });

  it("rejects updating a tracking number that belongs to another order", async () => {
    const [otherOrder] = await addTrackingNumbers(7, ["940011"]);

    await expect(
      updateTrackingNumbers(42, [
        { id: otherOrder.id, trackingNumber: "1Z999" },
      ]),
    ).rejects.toThrow(/belong to this order/i);
  });
});
