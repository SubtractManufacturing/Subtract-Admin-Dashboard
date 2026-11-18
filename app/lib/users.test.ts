import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  set: vi.fn(),
}));

vi.mock("./db", () => {
  const updateChain = {
    set: (v: unknown) => {
      mocks.set(v);
      return { where: () => ({ returning: mocks.returning }) };
    },
  };
  return {
    db: {
      update: (...a: unknown[]) => {
        mocks.update(...a);
        return updateChain;
      },
      insert: (...a: unknown[]) => mocks.insert(...a),
      select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
    },
  };
});
vi.mock("./events", () => ({ createEvent: vi.fn() }));

import { syncStaffUser } from "./users";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("syncStaffUser", () => {
  it("returns the record of an existing user and never inserts", async () => {
    mocks.returning.mockResolvedValue([
      { role: "Admin", status: "active", isArchived: false },
    ]);
    expect(await syncStaffUser("u1", "a@example.com", "Ada")).toEqual({
      role: "Admin",
      status: "active",
      isArchived: false,
    });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("returns null, without creating a row, when the user has none", async () => {
    mocks.returning.mockResolvedValue([]);
    expect(await syncStaffUser("u1", "a@example.com", null)).toBeNull();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not overwrite the stored email with an empty one", async () => {
    mocks.returning.mockResolvedValue([
      { role: "User", status: "active", isArchived: false },
    ]);
    await syncStaffUser("u1", "", "Ada");
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("email");
  });

  it("falls back to reading the existing row when the update fails", async () => {
    mocks.returning.mockRejectedValue(new Error("lock timeout"));
    mocks.limit.mockResolvedValue([
      { role: "User", status: "active", isArchived: false },
    ]);
    expect(await syncStaffUser("u1", "a@example.com", null)).toEqual({
      role: "User",
      status: "active",
      isArchived: false,
    });
  });

  it("fails closed when neither the update nor the read works", async () => {
    mocks.returning.mockRejectedValue(new Error("down"));
    mocks.limit.mockRejectedValue(new Error("down"));
    await expect(syncStaffUser("u1", "a@example.com", null)).rejects.toThrow(
      /Could not reach the database/,
    );
  });
});
